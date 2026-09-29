// Error handling shared by all route handlers: one JSON error shape
// { error: <code>, message?, issues? } and consistent status codes.

import { ZodError, type ZodType } from "zod";
import { issueFromDbError } from "@/lib/validation/issues";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
  }
}

export function json(data: unknown, init: number | ResponseInit = 200): Response {
  const opts = typeof init === "number" ? { status: init } : init;
  return Response.json(data, opts);
}

interface PgError {
  code?: string;
  message?: string;
  hint?: string | null;
  details?: string | null;
}

/** Maps a PostgREST / Postgres error to an ApiError. */
export function dbError(err: PgError): ApiError {
  const issue = issueFromDbError(err);
  const hint = err.hint ?? undefined;
  switch (err.code) {
    case "PGRST116":
      return new ApiError(404, "not_found");
    case "42501":
      return new ApiError(403, hint ?? "forbidden", err.message);
    case "28000":
      return new ApiError(401, "unauthorized", err.message);
    case "P0002":
      return new ApiError(404, hint ?? "not_found", err.message);
    case "22023":
    case "22P02":
      return new ApiError(400, hint ?? "bad_request", err.message);
    case "23505":
      return new ApiError(409, issue ?? "conflict", err.message);
    case "23503":
    case "23514":
      return new ApiError(422, issue ?? "constraint_violation", err.message);
    case "P0001":
      return new ApiError(422, issue ?? hint ?? "rejected", err.message);
    default:
      return new ApiError(500, "database_error", err.message);
  }
}

/** Unwraps a supabase-js result or throws the mapped error. */
export function unwrap<T>(res: { data: T; error: PgError | null }): T {
  if (res.error) throw dbError(res.error);
  return res.data;
}

export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "invalid_json");
  }
  return schema.parse(body);
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wraps a route handler: converts thrown errors into JSON responses. */
export function route<C>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        return json({ error: err.code, message: err.message !== err.code ? err.message : undefined, details: err.details }, err.status);
      }
      if (err instanceof ZodError) {
        return json({ error: "invalid_input", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
      }
      console.error(err);
      return json({ error: "internal_error" }, 500);
    }
  };
}

/** Next.js 15+ passes dynamic params as a promise. */
export type Params<P> = { params: Promise<P> };

export const uuidParam = (value: string, name = "id"): string => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(400, "invalid_id", `${name} is not a valid id`);
  }
  return value.toLowerCase();
};
