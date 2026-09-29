// Integration test harness: a throwaway PostgreSQL database with all migrations, PostgREST in
// front of it, and a small gateway that imitates the Supabase endpoints the API uses:
//   /rest/v1/*     -> PostgREST
//   /auth/v1/user  -> JWT check (returns the user from the token)
//   /storage/v1/object/* -> in-memory files; rows go into storage.objects as the caller,
//                           so the real Storage RLS policies from the migrations are enforced.
// Requirements: PG* env vars pointing at a PostgreSQL 15+ server, .bin/postgrest
// (scripts/get-postgrest.sh).

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import pg from "pg";

const ROOT = join(__dirname, "..", "..");
const DB = process.env.TEST_DB ?? "rb_integration";
const JWT_SECRET = "integration-test-secret-at-least-32-chars!!";

export interface Harness {
  url: string;
  pool: pg.Pool;
  sign(claims: Record<string, unknown>): string;
  createUser(email: string, name?: string): Promise<TestUser>;
  sql<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<T[]>;
  files: Map<string, Uint8Array>;
  stop(): Promise<void>;
}

export interface TestUser {
  id: string;
  email: string;
  token: string;
}

function psql(db: string, args: string[]) {
  execFileSync("psql", ["-q", "-v", "ON_ERROR_STOP=1", "-d", db, ...args], {
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, PGOPTIONS: "-c client_min_messages=error" },
  });
}

function b64url(data: Buffer | string) {
  return Buffer.from(data).toString("base64url");
}

export function signJwt(claims: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...claims }));
  const sig = createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function verifyJwt(token: string): Record<string, unknown> | null {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  const expected = createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  if (expected !== s) return null;
  return JSON.parse(Buffer.from(p, "base64url").toString());
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const isBytes = body instanceof Uint8Array;
  res.writeHead(status, { "content-type": isBytes ? "application/octet-stream" : "application/json", ...headers });
  res.end(isBytes ? body : JSON.stringify(body));
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as AddressInfo).port;
  await new Promise((r) => s.close(r));
  return port;
}

export async function startHarness(): Promise<Harness> {
  // 1. database
  psql("postgres", ["-c", `drop database if exists ${DB} with (force)`, "-c", `create database ${DB}`]);
  psql(DB, ["-f", join(ROOT, "supabase/tests/00_supabase_stub.sql")]);
  for (const f of readdirSync(join(ROOT, "supabase/migrations")).sort()) {
    psql(DB, ["-f", join(ROOT, "supabase/migrations", f)]);
  }
  psql(DB, ["-c", `
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'authenticator') then
        create role authenticator login noinherit password 'authenticator';
      end if;
    end $$;
    grant anon, authenticated, service_role to authenticator;
    grant select, insert, delete on storage.objects to service_role;
    grant usage on schema storage to service_role;
  `]);

  const pool = new pg.Pool({ database: DB, max: 4 });

  // 2. PostgREST
  const pgrstPort = await freePort();
  const host = process.env.PGHOST ?? "localhost";
  const isSocket = host.startsWith("/");
  const dbUri = isSocket
    ? `postgres://authenticator:authenticator@/${DB}?host=${encodeURIComponent(host)}&port=${process.env.PGPORT ?? 5432}`
    : `postgres://authenticator:authenticator@${host}:${process.env.PGPORT ?? 5432}/${DB}`;
  const pgrst: ChildProcess = spawn(process.env.POSTGREST_BIN ?? join(ROOT, ".bin/postgrest"), [], {
    env: {
      ...process.env,
      PGRST_DB_URI: dbUri,
      PGRST_DB_SCHEMAS: "public",
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_JWT_SECRET: JWT_SECRET,
      PGRST_SERVER_PORT: String(pgrstPort),
      PGRST_SERVER_HOST: "127.0.0.1",
      PGRST_LOG_LEVEL: "crit",
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  const pgrstUrl = `http://127.0.0.1:${pgrstPort}`;
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(pgrstUrl + "/");
      if (r.ok) break;
    } catch { /* not up yet */ }
    if (i > 100) throw new Error("PostgREST did not start");
    await new Promise((r) => setTimeout(r, 100));
  }

  // 3. gateway
  const files = new Map<string, Uint8Array>();

  async function asCaller<T>(claims: Record<string, unknown>, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const role = claims.role === "service_role" ? "service_role" : claims.role === "authenticated" ? "authenticated" : "anon";
      await client.query(`set local role ${role}`);
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      const out = await fn(client);
      await client.query("commit");
      return out;
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }

  const server: Server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://gateway");
      const auth = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
      const claims = verifyJwt(auth) ?? { role: "anon" };

      if (url.pathname.startsWith("/rest/v1/")) {
        const body = await readBody(req);
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === "string" && !["host", "content-length", "connection"].includes(k)) headers[k] = v;
        }
        const r = await fetch(pgrstUrl + url.pathname.slice("/rest/v1".length) + url.search, {
          method: req.method,
          headers,
          body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : new Uint8Array(body),
        });
        const out = Buffer.from(await r.arrayBuffer());
        const h: Record<string, string> = {};
        r.headers.forEach((v, k) => { if (!["content-length", "transfer-encoding", "connection"].includes(k)) h[k] = v; });
        res.writeHead(r.status, h);
        res.end(out);
        return;
      }

      if (url.pathname === "/auth/v1/user") {
        const c = verifyJwt(auth);
        if (!c || c.role !== "authenticated") return send(res, 401, { code: 401, msg: "invalid JWT" });
        return send(res, 200, { id: c.sub, email: c.email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
      }

      const m = /^\/storage\/v1\/object\/([^/]+)(?:\/(.+))?$/.exec(url.pathname);
      if (m) {
        const bucket = decodeURIComponent(m[1]!);
        const name = m[2] ? decodeURIComponent(m[2]) : "";
        const body = await readBody(req);
        if (req.method === "POST" && name) {
          try {
            await asCaller(claims, (c) => c.query("insert into storage.objects (bucket_id, name) values ($1, $2)", [bucket, name]));
          } catch (e) {
            const err = e as { code?: string; message?: string };
            if (err.code === "23505") return send(res, 409, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
            return send(res, 403, { statusCode: "403", error: "Unauthorized", message: err.message ?? "new row violates row-level security policy" });
          }
          files.set(`${bucket}/${name}`, new Uint8Array(body));
          return send(res, 200, { Key: `${bucket}/${name}`, Id: randomUUID() });
        }
        if (req.method === "GET" && name) {
          const rows = await asCaller(claims, (c) => c.query("select name from storage.objects where bucket_id = $1 and name = $2", [bucket, name]));
          const bytes = files.get(`${bucket}/${name}`);
          if (!rows.rowCount || !bytes) return send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
          return send(res, 200, bytes);
        }
        if (req.method === "DELETE" && !name) {
          const { prefixes } = JSON.parse(body.toString() || "{}") as { prefixes?: string[] };
          const rows = await asCaller(claims, (c) =>
            c.query("delete from storage.objects where bucket_id = $1 and name = any($2) returning name", [bucket, prefixes ?? []]));
          for (const r of rows.rows) files.delete(`${bucket}/${r.name}`);
          return send(res, 200, rows.rows.map((r) => ({ name: r.name, bucket_id: bucket })));
        }
      }
      send(res, 404, { error: "not_found", path: url.pathname });
    } catch (e) {
      send(res, 500, { error: String(e) });
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = signJwt({ role: "anon" });
  process.env.SUPABASE_SERVICE_ROLE_KEY = signJwt({ role: "service_role" });
  process.env.NEXT_PUBLIC_APP_URL = "https://app.test";

  return {
    url,
    pool,
    files,
    sign: signJwt,
    async sql(text, params) {
      return (await pool.query(text, params)).rows;
    },
    async createUser(email, name) {
      const id = randomUUID();
      await pool.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, email, { full_name: name ?? email.split("@")[0] }]);
      return { id, email, token: signJwt({ sub: id, email, role: "authenticated", aud: "authenticated" }) };
    },
    async stop() {
      await new Promise((r) => server.close(r));
      pgrst.kill();
      await pool.end();
    },
  };
}

/** Calls a Next.js route handler like the framework does. */
export async function call(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (req: Request, ctx: any) => Promise<Response>,
  opts: { method?: string; path?: string; token?: string | null; json?: unknown; body?: BodyInit; headers?: Record<string, string>; params?: Record<string, string> } = {},
): Promise<{ status: number; body: any; res: Response }> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body = opts.body;
  if (opts.json !== undefined) {
    body = JSON.stringify(opts.json);
    headers["content-type"] = "application/json";
  }
  const req = new Request(`https://app.test${opts.path ?? "/"}`, { method: opts.method ?? "GET", headers, body });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const type = res.headers.get("content-type") ?? "";
  const parsed = type.includes("application/json") ? await res.clone().json() : null;
  return { status: res.status, body: parsed, res };
}
