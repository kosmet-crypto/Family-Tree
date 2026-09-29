// End-to-end tests of the API routes against a real database (see harness.ts).
import { unzipSync, strFromU8 } from "fflate";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { call, startHarness, type Harness, type TestUser } from "./harness";

import * as health from "@/app/api/health/route";
import * as invites from "@/app/api/trees/[treeId]/invites/route";
import * as invite from "@/app/api/trees/[treeId]/invites/[inviteId]/route";
import * as preview from "@/app/api/invites/[token]/route";
import * as accept from "@/app/api/invites/[token]/accept/route";
import * as members from "@/app/api/trees/[treeId]/members/route";
import * as member from "@/app/api/trees/[treeId]/members/[userId]/route";
import * as merge from "@/app/api/trees/[treeId]/merge/route";
import * as backup from "@/app/api/trees/[treeId]/backup/route";
import * as restore from "@/app/api/trees/[treeId]/restore/route";
import * as importRoute from "@/app/api/backups/import/route";
import * as snapshots from "@/app/api/trees/[treeId]/snapshots/route";
import * as snapshotRestore from "@/app/api/trees/[treeId]/snapshots/[snapshotId]/restore/route";
import * as autoBackup from "@/app/api/trees/[treeId]/auto-backup/route";
import * as media from "@/app/api/trees/[treeId]/media/[mediaId]/route";
import * as billing from "@/app/api/billing/route";
import * as webhook from "@/app/api/webhooks/revenuecat/route";
import { syncFromRevenueCat } from "@/server/services/billing";
import { adminClient } from "@/server/supabase";

let h: Harness;
let ana: TestUser, boris: TestUser, ceca: TestUser;
let treeId: string;
const personIds: Record<string, string> = {};
let photoMediaId: string;

const asUser = (u: TestUser): SupabaseClient =>
  createClient(h.url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${u.token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

beforeAll(async () => {
  h = await startHarness();
  ana = await h.createUser("ana@example.com", "Ana");
  boris = await h.createUser("boris@example.com", "Boris");
  ceca = await h.createUser("ceca@example.com", "Ceca");
  process.env.REVENUECAT_WEBHOOK_AUTH = "rc-secret-123";

  // Ana builds a small tree directly through Supabase (as the app will).
  const db = asUser(ana);
  treeId = crypto.randomUUID();
  expect((await db.from("trees").insert({ id: treeId, name: "Петровић" })).error).toBeNull();
  for (const [key, first, birth] of [["milan", "Milan", "1930-01-01"], ["mira", "Mira", "1932-01-01"], ["jovan", "Jovan", "1960-05-05"]] as const) {
    personIds[key] = crypto.randomUUID();
    const r = await db.from("persons").insert({ id: personIds[key], tree_id: treeId, first_name: first, last_name: "Petrović", birth_date: birth });
    expect(r.error).toBeNull();
  }
  expect((await db.from("parent_child").insert([
    { tree_id: treeId, parent_id: personIds.milan, child_id: personIds.jovan },
    { tree_id: treeId, parent_id: personIds.mira, child_id: personIds.jovan },
  ])).error).toBeNull();
  expect((await db.from("partnerships").insert({ tree_id: treeId, person1_id: personIds.milan, person2_id: personIds.mira })).error).toBeNull();

  // One photo: upload to Storage, then register it.
  const path = `${treeId}/photos/${crypto.randomUUID()}.webp`;
  const up = await db.storage.from("family-media").upload(path, new Uint8Array([1, 2, 3, 4, 5]), { contentType: "image/webp" });
  expect(up.error).toBeNull();
  const ins = await db.from("media").insert({ tree_id: treeId, person_id: personIds.jovan, kind: "photo", storage_path: path, mime_type: "image/webp", size_bytes: 5 }).select("id").single();
  expect(ins.error).toBeNull();
  photoMediaId = ins.data!.id;
  expect((await db.from("persons").update({ avatar_media_id: photoMediaId }).eq("id", personIds.jovan)).error).toBeNull();
}, 60_000);

afterAll(async () => {
  await h?.stop();
});

describe("health", () => {
  it("answers", async () => {
    const r = await call(async () => health.GET());
    expect(r.body.ok).toBe(true);
  });
});

describe("invitations and members", () => {
  let token: string;

  it("requires sign-in and valid ids", async () => {
    expect((await call(invites.POST, { method: "POST", json: {}, params: { treeId } })).status).toBe(401);
    expect((await call(invites.GET, { token: ana.token, params: { treeId: "nope" } })).status).toBe(400);
  });

  it("owner creates an invitation link", async () => {
    const r = await call(invites.POST, { method: "POST", token: ana.token, json: { email: "Boris@Example.com", role: "editor" }, params: { treeId } });
    expect(r.status).toBe(201);
    expect(r.body.invite.url).toMatch(/^https:\/\/app\.test\/invite\?token=[0-9a-f]{48}$/);
    expect(r.body.invite).not.toHaveProperty("token");
    expect(r.body.invite.email).toBe("boris@example.com");
    token = r.body.invite.url.split("token=")[1];
    const list = await call(invites.GET, { token: ana.token, params: { treeId } });
    expect(list.body.invites).toHaveLength(1);
  });

  it("anyone with the link sees a preview", async () => {
    const r = await call(preview.GET, { params: { token } });
    expect(r.status).toBe(200);
    expect(r.body.invite).toMatchObject({ tree_name: "Петровић", inviter_name: "Ana", role: "editor", status: "pending", email_locked: true });
    expect((await call(preview.GET, { params: { token: "0".repeat(48) } })).status).toBe(404);
    expect((await call(preview.GET, { params: { token: "../../etc" } })).status).toBe(404);
  });

  it("only the invited email can accept, once", async () => {
    expect((await call(accept.POST, { method: "POST", params: { token } })).status).toBe(401);
    const wrong = await call(accept.POST, { method: "POST", token: ceca.token, params: { token } });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error).toBe("invite_email_mismatch");
    const ok = await call(accept.POST, { method: "POST", token: boris.token, params: { token } });
    expect(ok.status).toBe(200);
    expect(ok.body.treeId).toBe(treeId);
    const again = await call(accept.POST, { method: "POST", token: boris.token, params: { token } });
    expect(again.status).toBe(422);
    expect(again.body.error).toBe("invite_not_pending");
  });

  it("revoked links stop working", async () => {
    const r = await call(invites.POST, { method: "POST", token: ana.token, json: {}, params: { treeId } });
    const t = r.body.invite.url.split("token=")[1];
    expect((await call(invite.DELETE, { method: "DELETE", token: ana.token, params: { treeId, inviteId: r.body.invite.id } })).status).toBe(200);
    expect((await call(invite.DELETE, { method: "DELETE", token: ana.token, params: { treeId, inviteId: r.body.invite.id } })).status).toBe(404);
    expect((await call(accept.POST, { method: "POST", token: ceca.token, params: { token: t } })).body.error).toBe("invite_not_pending");
  });

  it("lists members and changes roles", async () => {
    const r = await call(members.GET, { token: boris.token, params: { treeId } });
    expect(r.body.members.map((m: { display_name: string; role: string }) => `${m.display_name}:${m.role}`).sort()).toEqual(["Ana:owner", "Boris:editor"]);
    expect((await call(member.PATCH, { method: "PATCH", token: boris.token, json: { role: "viewer" }, params: { treeId, userId: ana.id } })).status).toBe(404);
    expect((await call(member.PATCH, { method: "PATCH", token: ana.token, json: { role: "viewer" }, params: { treeId, userId: boris.id } })).status).toBe(200);
    // viewers cannot invite
    expect((await call(invites.POST, { method: "POST", token: boris.token, json: {}, params: { treeId } })).status).toBe(403);
    // owner cannot leave
    expect((await call(member.DELETE, { method: "DELETE", token: ana.token, params: { treeId, userId: ana.id } })).status).toBe(422);
    // members can leave
    expect((await call(member.DELETE, { method: "DELETE", token: boris.token, params: { treeId, userId: boris.id } })).status).toBe(200);
    expect((await call(members.GET, { token: boris.token, params: { treeId } })).body.members).toEqual([]);
  });
});

describe("backup and restore", () => {
  let json: any;
  let zip: Uint8Array;

  it("downloads a JSON backup", async () => {
    const r = await call(backup.GET, { token: ana.token, path: `/api/trees/${treeId}/backup`, params: { treeId } });
    expect(r.status).toBe(200);
    expect(r.res.headers.get("content-disposition")).toMatch(/porodicno-stablo-petrovic-\d{4}-\d{2}-\d{2}\.json/);
    json = r.body;
    expect(json.persons).toHaveLength(3);
    expect(json.media).toHaveLength(1);
    expect((await call(backup.GET, { token: ceca.token, params: { treeId } })).status).toBe(404);
  });

  it("downloads a ZIP with media files", async () => {
    const r = await call(backup.GET, { token: ana.token, path: `/api/trees/${treeId}/backup?format=zip`, params: { treeId } });
    expect(r.status).toBe(200);
    expect(r.res.headers.get("x-backup-files")).toBe("1");
    zip = new Uint8Array(await r.res.arrayBuffer());
    const entries = unzipSync(zip);
    expect(JSON.parse(strFromU8(entries["backup.json"]!)).persons).toHaveLength(3);
    expect([...entries[`media/${json.media[0].storage_path}`]!]).toEqual([1, 2, 3, 4, 5]);
  });

  it("restores the tree from JSON and from a ZIP upload", async () => {
    const db = asUser(ana);
    await db.from("persons").delete().eq("tree_id", treeId);
    expect((await db.from("persons").select("id")).data).toHaveLength(0);

    const r = await call(restore.POST, { method: "POST", token: ana.token, body: JSON.stringify(json), headers: { "content-type": "application/json" }, params: { treeId } });
    expect(r.status).toBe(200);
    expect(r.body.restored).toEqual({ persons: 3, parent_child: 2, partnerships: 1 });
    const jovan = await db.from("persons").select("avatar_media_id").eq("id", personIds.jovan).single();
    expect(jovan.data!.avatar_media_id).toBe(photoMediaId);

    const form = new FormData();
    form.append("file", new Blob([zip as BlobPart], { type: "application/zip" }), "backup.zip");
    const z = await call(restore.POST, { method: "POST", token: ana.token, body: form, params: { treeId } });
    expect(z.status).toBe(200);
    expect(z.body.restored.persons).toBe(3);
  });

  it("rejects bad files and non-owners", async () => {
    const bad = await call(restore.POST, { method: "POST", token: ana.token, body: '{"format":"other"}', params: { treeId } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("bad_backup_format");
    expect((await call(restore.POST, { method: "POST", token: ana.token, body: "PK\u0003\u0004garbage", params: { treeId } })).body.error).toBe("bad_zip");
    const other = await call(restore.POST, { method: "POST", token: ceca.token, body: JSON.stringify(json), params: { treeId } });
    expect(other.status).toBe(403);
  });

  it("imports a ZIP as a new tree with its own copies of the files", async () => {
    const r = await call(importRoute.POST, { method: "POST", token: ceca.token, path: "/api/backups/import?name=Kopija", body: zip as BodyInit, params: {} });
    expect(r.status).toBe(201);
    const imp = r.body.imported;
    expect(imp).toMatchObject({ persons: 3, parent_child: 2, partnerships: 1, media_imported: 1, media_skipped: 0 });
    const db = asUser(ceca);
    const tree = await db.from("trees").select("name, root_person_id").eq("id", imp.treeId).single();
    expect(tree.data!.name).toBe("Kopija");
    const persons = await db.from("persons").select("id, first_name, avatar_media_id").eq("tree_id", imp.treeId);
    expect(persons.data).toHaveLength(3);
    expect(persons.data!.some((p) => Object.values(personIds).includes(p.id))).toBe(false); // new ids
    const m = await db.from("media").select("id, storage_path, person_id").eq("tree_id", imp.treeId).single();
    expect(m.data!.storage_path.startsWith(`${imp.treeId}/photos/`)).toBe(true);
    expect(persons.data!.find((p) => p.first_name === "Jovan")!.avatar_media_id).toBe(m.data!.id);
    expect(h.files.get(`family-media/${m.data!.storage_path}`)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it("stores, lists and restores snapshots", async () => {
    const c = await call(snapshots.POST, { method: "POST", token: ana.token, json: { label: "pre izmena" }, params: { treeId } });
    expect(c.status).toBe(201);
    await asUser(ana).from("persons").update({ first_name: "Promenjen" }).eq("id", personIds.milan);
    const list = await call(snapshots.GET, { token: ana.token, params: { treeId } });
    expect(list.body.snapshots.find((s: { id: string }) => s.id === c.body.id)).toMatchObject({ kind: "manual", label: "pre izmena", person_count: 3 });
    const r = await call(snapshotRestore.POST, { method: "POST", token: ana.token, params: { treeId, snapshotId: c.body.id } });
    expect(r.status).toBe(200);
    const milan = await asUser(ana).from("persons").select("first_name").eq("id", personIds.milan).single();
    expect(milan.data!.first_name).toBe("Milan");
    expect((await call(snapshotRestore.POST, { method: "POST", token: ana.token, params: { treeId, snapshotId: crypto.randomUUID() } })).status).toBe(404);
  });

  it("automatic backup runs at most once per day", async () => {
    const first = await call(autoBackup.POST, { method: "POST", token: ana.token, params: { treeId } });
    expect(first.body.id).toMatch(/^[0-9a-f-]{36}$/);
    const second = await call(autoBackup.POST, { method: "POST", token: ana.token, params: { treeId } });
    expect(second.body.id).toBeNull();
  });
});

describe("merge", () => {
  it("merges a tree the user edits into another, linking duplicates", async () => {
    // Ceca's imported copy -> invite Ceca as editor of Ana's tree, then merge the copy into it.
    const inv = await call(invites.POST, { method: "POST", token: ana.token, json: { role: "editor" }, params: { treeId } });
    await call(accept.POST, { method: "POST", token: ceca.token, params: { token: inv.body.invite.url.split("token=")[1] } });
    const db = asUser(ceca);
    const copy = await db.from("trees").select("id").eq("name", "Kopija").single();
    const src = await db.from("persons").select("id, first_name").eq("tree_id", copy.data!.id);
    const byName = Object.fromEntries(src.data!.map((p) => [p.first_name, p.id]));
    const r = await call(merge.POST, {
      method: "POST", token: ceca.token, params: { treeId },
      json: { sourceTreeId: copy.data!.id, personMap: { [byName.Milan]: personIds.milan, [byName.Mira]: personIds.mira, [byName.Jovan]: personIds.jovan } },
    });
    expect(r.status).toBe(200);
    expect(r.body.merged).toMatchObject({ persons_added: 0, persons_linked: 3, parent_child_added: 0, partnerships_added: 0 });
    const bad = await call(merge.POST, { method: "POST", token: boris.token, params: { treeId }, json: { sourceTreeId: copy.data!.id } });
    expect(bad.status).toBe(403);
  });
});

describe("media", () => {
  it("deletes the row and the file", async () => {
    const m = await asUser(ana).from("media").select("storage_path").eq("id", photoMediaId).single();
    const key = `family-media/${m.data!.storage_path}`;
    const r = await call(media.DELETE, { method: "DELETE", token: ana.token, params: { treeId, mediaId: photoMediaId } });
    expect(r.status).toBe(200);
    expect(r.body.fileDeleted).toBe(true);
    expect(h.files.has(key)).toBe(false);
    expect((await call(media.DELETE, { method: "DELETE", token: ana.token, params: { treeId, mediaId: photoMediaId } })).status).toBe(404);
  });
});

describe("billing (RevenueCat)", () => {
  const event = (over: Record<string, unknown>) => ({
    event: {
      id: crypto.randomUUID(), type: "INITIAL_PURCHASE", app_user_id: ana.id, entitlement_ids: ["premium"],
      event_timestamp_ms: Date.now(), expiration_at_ms: Date.now() + 30 * 86_400_000, environment: "PRODUCTION", ...over,
    },
  });
  const send = (body: unknown, auth = "rc-secret-123") =>
    call(webhook.POST, { method: "POST", json: body, headers: auth ? { authorization: auth } : {} });

  it("rejects calls without the shared secret", async () => {
    expect((await send(event({}), "")).status).toBe(401);
    expect((await send(event({}), "wrong")).status).toBe(401);
  });

  it("grants premium, is idempotent and ignores stale events", async () => {
    const purchase = event({ event_timestamp_ms: Date.now() - 1000 });
    const r = await send(purchase, "Bearer rc-secret-123");
    expect(r.body).toMatchObject({ duplicate: false, applied: 1 });
    expect((await send(purchase)).body.duplicate).toBe(true);
    const status = await call(billing.GET, { token: ana.token });
    expect(status.body).toMatchObject({ plan: "premium", premium: true });
    expect(status.body.photos.limit).toBeNull();

    const stale = await send(event({ type: "EXPIRATION", event_timestamp_ms: Date.now() - 60_000 }));
    expect(stale.body.applied).toBe(0);
    expect((await call(billing.GET, { token: ana.token })).body.plan).toBe("premium");
  });

  it("keeps access on cancellation and removes it on expiration", async () => {
    const until = Date.now() + 5 * 86_400_000;
    await send(event({ type: "CANCELLATION", expiration_at_ms: until }));
    let s = (await call(billing.GET, { token: ana.token })).body;
    expect(s.premium).toBe(true);
    expect(new Date(s.planExpiresAt).getTime()).toBe(until);
    await send(event({ type: "EXPIRATION", expiration_at_ms: Date.now() - 1000, event_timestamp_ms: Date.now() + 1000 }));
    s = (await call(billing.GET, { token: ana.token })).body;
    expect(s).toMatchObject({ plan: "free", premium: false });
  });

  it("ignores other entitlements, unknown users and (optionally) sandbox", async () => {
    expect((await send(event({ entitlement_ids: ["other"] }))).body.applied).toBe(0);
    expect((await send(event({ app_user_id: "$RCAnonymousID:abc" }))).body.applied).toBe(0);
    process.env.REVENUECAT_IGNORE_SANDBOX = "true";
    expect((await send(event({ app_user_id: boris.id, environment: "SANDBOX" }))).body.ignored).toBe("sandbox");
    delete process.env.REVENUECAT_IGNORE_SANDBOX;
    const rows = await h.sql("select count(*)::int as n from public.billing_events");
    expect(rows[0]!.n).toBeGreaterThanOrEqual(7);
  });

  it("transfer removes premium from the old user", async () => {
    await send(event({ app_user_id: boris.id, event_timestamp_ms: Date.now() + 2000 }));
    const t = await send(event({ type: "TRANSFER", transferred_from: [boris.id], transferred_to: [ceca.id], app_user_id: null, entitlement_ids: null, event_timestamp_ms: Date.now() + 3000 }));
    expect(t.body.resync).toEqual([ceca.id]);
    expect((await call(billing.GET, { token: boris.token })).body.plan).toBe("free");
  });

  it("syncs the plan from the RevenueCat REST API", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const fake = (async (url: string) => {
      expect(url).toContain(ceca.id);
      return Response.json({ subscriber: { entitlements: { premium: { expires_date: future } } } });
    }) as unknown as typeof fetch;
    const r = await syncFromRevenueCat(adminClient(), ceca.id, { secretKey: "sk_test", entitlement: "premium", fetchImpl: fake });
    expect(r.plan).toBe("premium");
    expect((await call(billing.GET, { token: ceca.token })).body.premium).toBe(true);
  });
});

describe("photo limit (when switched on)", () => {
  it("import skips photos above the free limit", async () => {
    await h.sql("update public.app_settings set value = '1' where key = 'free_photo_limit'");
    const dave = await h.createUser("dave@example.com", "Dave");
    // Ceca's imported copy still has one photo
    const copy = await asUser(ceca).from("trees").select("id").eq("name", "Kopija").single();
    const z = await call(backup.GET, { token: ceca.token, params: { treeId: copy.data!.id }, path: `/api/trees/${copy.data!.id}/backup?format=zip` });
    const zipBytes = new Uint8Array(await z.res.arrayBuffer());
    const first = await call(importRoute.POST, { method: "POST", token: dave.token, body: zipBytes as BodyInit });
    expect(first.body.imported).toMatchObject({ media_imported: 1, media_skipped: 0 });
    const second = await call(importRoute.POST, { method: "POST", token: dave.token, body: zipBytes as BodyInit });
    expect(second.body.imported).toMatchObject({ persons: 3, media_imported: 0, media_skipped: 1 });
    await h.sql("update public.app_settings set value = 'null' where key = 'free_photo_limit'");
  });
});
