import { strToU8, zipSync } from "fflate";
import { ApiError, dbError, route } from "./http";
import { readBackup, remapIds } from "./services/backup";
import { planChangesFor, webhookAuthorized, type RevenueCatEvent } from "./services/billing";
import { tokenParam } from "./services/invites";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("RevenueCat mapping", () => {
  const ev = (over: Partial<RevenueCatEvent>): RevenueCatEvent => ({
    id: "e", type: "INITIAL_PURCHASE", app_user_id: U1, entitlement_ids: ["premium"], expiration_at_ms: 1_900_000_000_000, ...over,
  });

  it("grants, keeps and revokes", () => {
    expect(planChangesFor(ev({}), "premium")).toEqual([{ userId: U1, plan: "premium", expiresAt: new Date(1_900_000_000_000).toISOString() }]);
    expect(planChangesFor(ev({ type: "CANCELLATION" }), "premium")[0]).toMatchObject({ keepPlan: true });
    expect(planChangesFor(ev({ type: "EXPIRATION" }), "premium")[0]).toMatchObject({ plan: "free" });
    expect(planChangesFor(ev({ type: "NON_RENEWING_PURCHASE", expiration_at_ms: null }), "premium")[0]!.expiresAt).toBeNull();
  });

  it("uses aliases, skips anonymous ids and other entitlements", () => {
    expect(planChangesFor(ev({ app_user_id: "$RCAnonymousID:x", aliases: [U2, "$RCAnonymousID:x"] }), "premium").map((c) => c.userId)).toEqual([U2]);
    expect(planChangesFor(ev({ entitlement_ids: ["gold"] }), "premium")).toEqual([]);
    expect(planChangesFor(ev({ entitlement_ids: null, entitlement_id: "premium" }), "premium")).toHaveLength(1);
    expect(planChangesFor(ev({ type: "TEST" }), "premium")).toEqual([]);
  });

  it("transfer downgrades the previous owner", () => {
    expect(planChangesFor(ev({ type: "TRANSFER", transferred_from: [U1], transferred_to: [U2] }), "premium"))
      .toEqual([{ userId: U1, plan: "free", expiresAt: null }]);
  });

  it("checks the webhook secret", () => {
    expect(webhookAuthorized("abc", "abc")).toBe(true);
    expect(webhookAuthorized("Bearer abc", "abc")).toBe(true);
    expect(webhookAuthorized("abcd", "abc")).toBe(false);
    expect(webhookAuthorized(null, "abc")).toBe(false);
    expect(webhookAuthorized("", "")).toBe(false);
  });
});

describe("backup files", () => {
  const data = {
    format: "roots-branches", version: 1, exported_at: "2026-01-01T00:00:00Z",
    tree: { id: id(1), name: "T", root_person_id: id(2) },
    persons: [{ id: id(2), avatar_media_id: id(9) }, { id: id(3) }],
    parent_child: [{ id: id(4), parent_id: id(2), child_id: id(3) }],
    partnerships: [],
    media: [{ id: id(9), person_id: id(2), storage_path: `${id(1)}/photos/a.webp`, kind: "photo" }],
  };

  it("re-generates every id consistently", () => {
    let n = 100;
    const { data: out } = remapIds(data as never, () => id(++n));
    expect(out.persons.map((p) => p.id)).toEqual([id(101), id(102)]);
    expect(out.parent_child[0]).toMatchObject({ id: id(104), parent_id: id(101), child_id: id(102) });
    expect(out.media[0]).toMatchObject({ id: id(103), person_id: id(101) });
    expect(out.persons[0]!.avatar_media_id).toBe(id(103));
    expect(out.tree.root_person_id).toBe(id(101));
  });

  it("reads JSON and ZIP uploads", () => {
    expect(readBackup(strToU8(JSON.stringify(data))).files.size).toBe(0);
    const zip = zipSync({ "backup.json": strToU8(JSON.stringify(data)), [`media/${data.media[0]!.storage_path}`]: new Uint8Array([7]) });
    const r = readBackup(zip);
    expect(r.data.persons).toHaveLength(2);
    expect([...r.files.get(data.media[0]!.storage_path)!]).toEqual([7]);
    expect(() => readBackup(zipSync({ "x.txt": strToU8("x") }))).toThrow(ApiError);
    expect(() => readBackup(strToU8("nope"))).toThrow(/invalid_json/);
    const bomb = zipSync({ "backup.json": strToU8(JSON.stringify(data)), "media/x": new Uint8Array(2048) });
    expect(() => readBackup(bomb, 1024)).toThrow(/backup_too_large/);
  });
});

describe("http helpers", () => {
  it("maps database errors to status codes", () => {
    expect(dbError({ code: "42501", message: "denied" }).status).toBe(403);
    expect(dbError({ code: "P0001", hint: "cycle", message: "x" })).toMatchObject({ status: 422, code: "cycle" });
    expect(dbError({ code: "P0001", hint: "invite_expired", message: "x" })).toMatchObject({ status: 422, code: "invite_expired" });
    expect(dbError({ code: "23505", message: 'violates unique constraint "parent_child_unique"' })).toMatchObject({ status: 409, code: "duplicate_relation" });
    expect(dbError({ code: "PGRST116" }).status).toBe(404);
    expect(dbError({ code: "XX000" }).status).toBe(500);
  });

  it("turns thrown errors into JSON responses", async () => {
    const h = route(async () => { throw new ApiError(418, "teapot"); });
    const res = await h(new Request("https://x"), {});
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ error: "teapot" });
    const boom = route(async () => { throw new Error("secret detail"); });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r2 = await boom(new Request("https://x"), {});
    spy.mockRestore();
    expect(await r2.json()).toEqual({ error: "internal_error" });
  });

  it("validates invitation tokens", () => {
    expect(tokenParam("a".repeat(48))).toBe("a".repeat(48));
    expect(() => tokenParam("x")).toThrow(ApiError);
  });
});
