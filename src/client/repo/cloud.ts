// Cloud mode: Supabase (RLS protects everything), Realtime for live updates from other members.

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BackupFile } from "@/lib/backup/schema";
import { config } from "@/lib/config";
import { extensionFor } from "@/lib/media/compress";
import { mediaStoragePath } from "@/lib/media/quota";
import type { EntryMode, Media, ParentChild, Partnership, Person, Tree, TreeRole } from "@/lib/types/db";
import { issueFromDbError } from "@/lib/validation/issues";
import { clientConfig } from "../config";
import { RepoError } from "./errors";
import type { NewParentChild, NewPartnership, NewPerson, Repo, TreeData, TreeSummary } from "./types";

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) client = createBrowserClient(clientConfig.supabaseUrl, clientConfig.supabaseAnonKey);
  return client;
}

type PgErr = { code?: string; message?: string; hint?: string | null };

function fail(err: PgErr): never {
  const code = issueFromDbError(err) ?? err.hint ?? (err.code === "42501" ? "forbidden" : err.code) ?? "error";
  throw new RepoError(code, err.message);
}

function ok<T>(res: { data: T; error: PgErr | null }): T {
  if (res.error) fail(res.error);
  return res.data;
}

/** Calls an API route with the current session token. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase().auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set("authorization", `Bearer ${data.session.access_token}`);
  const res = await fetch(`${clientConfig.apiBase}${path}`, { ...init, headers });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    const body = type.includes("json") ? await res.json().catch(() => ({})) : {};
    throw new RepoError((body as { error?: string }).error ?? `http_${res.status}`);
  }
  return (type.includes("json") ? res.json() : res.blob()) as Promise<T>;
}

export class CloudRepo implements Repo {
  readonly mode = "cloud" as const;
  private db = supabase();

  private async uid(): Promise<string> {
    const { data } = await this.db.auth.getUser();
    if (!data.user) throw new RepoError("unauthorized");
    return data.user.id;
  }

  async listTrees(): Promise<TreeSummary[]> {
    const uid = await this.uid();
    const rows = ok(await this.db.from("tree_members").select("role, trees(id, name, updated_at)").eq("user_id", uid)) as unknown as {
      role: TreeRole; trees: { id: string; name: string; updated_at: string } | null;
    }[];
    return rows
      .filter((r) => r.trees)
      .map((r) => ({ id: r.trees!.id, name: r.trees!.name, updated_at: r.trees!.updated_at, role: r.role }))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async createTree(name: string): Promise<Tree> {
    const id = crypto.randomUUID();
    ok(await this.db.from("trees").insert({ id, name: name.trim().slice(0, 120) || "Породично стабло" }));
    return ok(await this.db.from("trees").select("*").eq("id", id).single()) as Tree;
  }

  async updateTree(id: string, patch: Partial<Tree>): Promise<void> {
    ok(await this.db.from("trees").update(patch).eq("id", id));
  }

  async deleteTree(id: string): Promise<void> {
    ok(await this.db.from("trees").delete().eq("id", id));
  }

  async loadTree(id: string): Promise<TreeData> {
    const uid = await this.uid();
    const [tree, member, persons, parentChild, partnerships, media] = await Promise.all([
      this.db.from("trees").select("*").eq("id", id).maybeSingle(),
      this.db.from("tree_members").select("role").eq("tree_id", id).eq("user_id", uid).maybeSingle(),
      this.db.from("persons").select("*").eq("tree_id", id),
      this.db.from("parent_child").select("*").eq("tree_id", id),
      this.db.from("partnerships").select("*").eq("tree_id", id),
      this.db.from("media").select("*").eq("tree_id", id),
    ]);
    const t = ok(tree) as Tree | null;
    if (!t) throw new RepoError("tree_not_found");
    return {
      tree: t,
      role: ((ok(member) as { role: TreeRole } | null)?.role ?? "viewer"),
      persons: ok(persons) as Person[],
      parentChild: ok(parentChild) as ParentChild[],
      partnerships: ok(partnerships) as Partnership[],
      media: ok(media) as Media[],
    };
  }

  async savePerson(p: NewPerson): Promise<Person> {
    const { created_at: _c, updated_at: _u, created_by: _b, ...row } = p as Person;
    void _c; void _u; void _b;
    delete (row as Partial<Person> & { search_text?: string }).search_text;
    if (p.id) {
      const { tree_id: _t, id, ...patch } = row;
      void _t;
      const exists = ok(await this.db.from("persons").select("id").eq("id", id).maybeSingle());
      if (exists) return ok(await this.db.from("persons").update(patch).eq("id", id).select("*").single()) as Person;
    }
    const created = ok(await this.db.from("persons").insert(row).select("*").single()) as Person;
    const tree = ok(await this.db.from("trees").select("root_person_id").eq("id", p.tree_id).single()) as { root_person_id: string | null };
    if (!tree.root_person_id) await this.db.from("trees").update({ root_person_id: created.id }).eq("id", p.tree_id);
    return created;
  }

  async deletePerson(_treeId: string, id: string): Promise<void> {
    ok(await this.db.from("persons").delete().eq("id", id));
  }

  async addParentChild(edge: NewParentChild): Promise<ParentChild> {
    return ok(await this.db.from("parent_child").insert(edge).select("*").single()) as ParentChild;
  }

  async deleteParentChild(_treeId: string, id: string): Promise<void> {
    ok(await this.db.from("parent_child").delete().eq("id", id));
  }

  async addPartnership(p: NewPartnership): Promise<Partnership> {
    return ok(await this.db.from("partnerships").insert(p).select("*").single()) as Partnership;
  }

  async updatePartnership(_treeId: string, id: string, patch: Partial<Partnership>): Promise<void> {
    const { kind, status, start_date, start_place, end_date, sort_order, notes } = patch;
    const clean = Object.fromEntries(Object.entries({ kind, status, start_date, start_place, end_date, sort_order, notes }).filter(([, v]) => v !== undefined));
    ok(await this.db.from("partnerships").update(clean).eq("id", id));
  }

  async deletePartnership(_treeId: string, id: string): Promise<void> {
    ok(await this.db.from("partnerships").delete().eq("id", id));
  }

  async uploadPhoto(treeId: string, personId: string, file: { blob: Blob; width: number; height: number; mimeType: string }): Promise<Media> {
    const id = crypto.randomUUID();
    const path = mediaStoragePath(treeId, "photo", id, extensionFor(file.mimeType));
    const up = await this.db.storage.from(config.storageBucket).upload(path, file.blob, { contentType: file.mimeType });
    if (up.error) throw new RepoError(/security|policy|403/i.test(up.error.message) ? "photo_quota_exceeded" : "upload_failed", up.error.message);
    const res = await this.db.from("media").insert({
      id, tree_id: treeId, person_id: personId, kind: "photo", storage_path: path,
      mime_type: file.mimeType, size_bytes: file.blob.size, width: file.width, height: file.height,
    }).select("*").single();
    if (res.error) {
      await this.db.storage.from(config.storageBucket).remove([path]);
      fail(res.error);
    }
    return res.data as Media;
  }

  private urls = new Map<string, { url: string; until: number }>();

  async mediaUrl(media: Media): Promise<string> {
    const c = this.urls.get(media.id);
    if (c && c.until > Date.now()) return c.url;
    const { data } = await this.db.storage.from(config.storageBucket).createSignedUrl(media.storage_path, 3600);
    const url = data?.signedUrl ?? "";
    this.urls.set(media.id, { url, until: Date.now() + 3_300_000 });
    return url;
  }

  async deleteMedia(treeId: string, id: string): Promise<void> {
    await api(`/api/trees/${treeId}/media/${id}`, { method: "DELETE" });
  }

  async exportJson(treeId: string): Promise<BackupFile> {
    return ok(await this.db.rpc("export_tree", { p_tree: treeId })) as BackupFile;
  }

  async importJson(data: BackupFile, name?: string): Promise<string> {
    const q = name ? `?name=${encodeURIComponent(name)}` : "";
    const res = await api<{ imported: { treeId: string } }>(`/api/backups/import${q}`, {
      method: "POST", body: JSON.stringify(data), headers: { "content-type": "application/json" },
    });
    return res.imported.treeId;
  }

  async getEntryMode(): Promise<EntryMode> {
    const uid = await this.uid();
    const row = ok(await this.db.from("profiles").select("entry_mode").eq("id", uid).single()) as { entry_mode: EntryMode };
    return row.entry_mode;
  }

  async setEntryMode(mode: EntryMode): Promise<void> {
    const uid = await this.uid();
    ok(await this.db.from("profiles").update({ entry_mode: mode }).eq("id", uid));
  }

  subscribe(treeId: string, onChange: () => void): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const debounced = () => { clearTimeout(timer); timer = setTimeout(onChange, 250); };
    const channel = this.db.channel(`tree:${treeId}`);
    for (const table of ["persons", "parent_child", "partnerships", "media"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `tree_id=eq.${treeId}` }, debounced);
    }
    channel.on("postgres_changes", { event: "*", schema: "public", table: "trees", filter: `id=eq.${treeId}` }, debounced);
    channel.subscribe();
    return () => { clearTimeout(timer); void this.db.removeChannel(channel); };
  }
}
