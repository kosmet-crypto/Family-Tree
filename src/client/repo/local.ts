// Local mode: everything in this browser's IndexedDB. The same validation rules as the database
// triggers are applied here, since there is no server to enforce them.

import { remapIds } from "@/lib/backup/remap";
import type { BackupFile } from "@/lib/backup/schema";
import { FamilyGraph } from "@/lib/graph/family-graph";
import { validateParentChild, validatePartnership } from "@/lib/validation/relations";
import type { EntryMode, Media, ParentChild, Partnership, Person, Tree } from "@/lib/types/db";
import { idb } from "../idb";
import { RepoError } from "./errors";
import type { NewParentChild, NewPartnership, NewPerson, Repo, TreeData, TreeSummary } from "./types";

const LOCAL_USER = "00000000-0000-4000-8000-000000000000";

interface TreeDoc {
  tree: Tree;
  persons: Person[];
  parent_child: ParentChild[];
  partnerships: Partnership[];
  media: Media[];
}

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

function emptyPerson(treeId: string): Person {
  return {
    id: uuid(), tree_id: treeId, first_name: "", middle_name: null, last_name: null, birth_name: null, nickname: null,
    gender: "unknown", birth_date: null, birth_date_precision: "exact", birth_place: null, is_living: true,
    death_date: null, death_date_precision: "exact", death_place: null, occupation: null, bio: null, notes: null,
    avatar_media_id: null, extra: {}, created_at: now(), updated_at: now(),
  };
}

export class LocalRepo implements Repo {
  readonly mode = "local" as const;
  private listeners = new Map<string, Set<() => void>>();
  private channel: BroadcastChannel | null =
    typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("roots-branches") : null;

  constructor() {
    // other tabs of the same browser
    if (this.channel) this.channel.onmessage = (e) => this.emit(String(e.data), false);
  }

  private async ids(): Promise<string[]> {
    return (await idb.get<string[]>("trees")) ?? [];
  }

  private async doc(id: string): Promise<TreeDoc> {
    const d = await idb.get<TreeDoc>(`tree:${id}`);
    if (!d) throw new RepoError("tree_not_found");
    return d;
  }

  private async write(d: TreeDoc): Promise<void> {
    d.tree.updated_at = now();
    await idb.set(`tree:${d.tree.id}`, d);
    this.emit(d.tree.id, true);
  }

  private emit(treeId: string, broadcast: boolean) {
    this.listeners.get(treeId)?.forEach((cb) => cb());
    if (broadcast) this.channel?.postMessage(treeId);
  }

  private graph(d: TreeDoc) {
    return new FamilyGraph(d.persons, d.parent_child, d.partnerships);
  }

  async listTrees(): Promise<TreeSummary[]> {
    const out: TreeSummary[] = [];
    for (const id of await this.ids()) {
      const d = await idb.get<TreeDoc>(`tree:${id}`);
      if (d) out.push({ id, name: d.tree.name, role: "owner", updated_at: d.tree.updated_at, person_count: d.persons.length });
    }
    return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async createTree(name: string): Promise<Tree> {
    const tree: Tree = {
      id: uuid(), owner_id: LOCAL_USER, name: name.trim().slice(0, 120) || "Породично стабло", description: null,
      entry_mode: "simple", root_person_id: null, created_at: now(), updated_at: now(),
    };
    await idb.set(`tree:${tree.id}`, { tree, persons: [], parent_child: [], partnerships: [], media: [] } satisfies TreeDoc);
    await idb.set("trees", [...(await this.ids()), tree.id]);
    return tree;
  }

  async updateTree(id: string, patch: Partial<Tree>): Promise<void> {
    const d = await this.doc(id);
    d.tree = { ...d.tree, ...patch };
    await this.write(d);
  }

  async deleteTree(id: string): Promise<void> {
    const d = await idb.get<TreeDoc>(`tree:${id}`);
    for (const m of d?.media ?? []) await idb.del(`blob:${m.id}`);
    await idb.del(`tree:${id}`);
    await idb.set("trees", (await this.ids()).filter((x) => x !== id));
  }

  async loadTree(id: string): Promise<TreeData> {
    const d = await this.doc(id);
    return { tree: d.tree, role: "owner", persons: d.persons, parentChild: d.parent_child, partnerships: d.partnerships, media: d.media };
  }

  async savePerson(input: NewPerson): Promise<Person> {
    const d = await this.doc(input.tree_id);
    const existing = input.id ? d.persons.find((p) => p.id === input.id) : undefined;
    const person: Person = { ...(existing ?? emptyPerson(input.tree_id)), ...input, updated_at: now() } as Person;
    if (person.is_living && (person.death_date || person.death_place)) throw new RepoError("living_with_death_date");
    if (existing) d.persons = d.persons.map((p) => (p.id === person.id ? person : p));
    else d.persons.push(person);
    if (!d.tree.root_person_id) d.tree.root_person_id = person.id;
    await this.write(d);
    return person;
  }

  async deletePerson(treeId: string, id: string): Promise<void> {
    const d = await this.doc(treeId);
    d.persons = d.persons.filter((p) => p.id !== id);
    d.parent_child = d.parent_child.filter((e) => e.parent_id !== id && e.child_id !== id);
    d.partnerships = d.partnerships.filter((e) => e.person1_id !== id && e.person2_id !== id);
    d.media = d.media.map((m) => (m.person_id === id ? { ...m, person_id: null } : m));
    if (d.tree.root_person_id === id) d.tree.root_person_id = d.persons[0]?.id ?? null;
    await this.write(d);
  }

  async addParentChild(edge: NewParentChild): Promise<ParentChild> {
    const d = await this.doc(edge.tree_id);
    const check = validateParentChild(this.graph(d), edge);
    if (!check.ok) throw new RepoError(check.errors[0]!.code);
    const row: ParentChild = { id: uuid(), start_date: null, notes: null, ...edge, created_at: now(), updated_at: now() };
    d.parent_child.push(row);
    await this.write(d);
    return row;
  }

  async deleteParentChild(treeId: string, id: string): Promise<void> {
    const d = await this.doc(treeId);
    d.parent_child = d.parent_child.filter((e) => e.id !== id);
    await this.write(d);
  }

  async addPartnership(p: NewPartnership): Promise<Partnership> {
    const d = await this.doc(p.tree_id);
    const check = validatePartnership(this.graph(d), p);
    if (!check.ok) throw new RepoError(check.errors[0]!.code);
    const [a, b] = p.person1_id < p.person2_id ? [p.person1_id, p.person2_id] : [p.person2_id, p.person1_id];
    const row: Partnership = {
      id: uuid(), start_place: null, notes: null, sort_order: 0, ...p, person1_id: a, person2_id: b, created_at: now(), updated_at: now(),
    };
    d.partnerships.push(row);
    await this.write(d);
    return row;
  }

  async updatePartnership(treeId: string, id: string, patch: Partial<Partnership>): Promise<void> {
    const d = await this.doc(treeId);
    d.partnerships = d.partnerships.map((p) => (p.id === id ? { ...p, ...patch, id, updated_at: now() } : p));
    await this.write(d);
  }

  async deletePartnership(treeId: string, id: string): Promise<void> {
    const d = await this.doc(treeId);
    d.partnerships = d.partnerships.filter((p) => p.id !== id);
    await this.write(d);
  }

  async uploadPhoto(treeId: string, personId: string, file: { blob: Blob; width: number; height: number; mimeType: string }): Promise<Media> {
    const d = await this.doc(treeId);
    const media: Media = {
      id: uuid(), tree_id: treeId, person_id: personId, kind: "photo", storage_path: `local/${uuid()}`,
      mime_type: file.mimeType, size_bytes: file.blob.size, width: file.width, height: file.height,
      caption: null, taken_on: null, uploaded_by: LOCAL_USER, is_copy: false, created_at: now(),
    };
    await idb.set(`blob:${media.id}`, file.blob);
    d.media.push(media);
    await this.write(d);
    return media;
  }

  private urls = new Map<string, string>();

  async mediaUrl(media: Media): Promise<string> {
    const cached = this.urls.get(media.id);
    if (cached) return cached;
    const blob = await idb.get<Blob>(`blob:${media.id}`);
    if (!blob) return "";
    const url = URL.createObjectURL(blob);
    this.urls.set(media.id, url);
    return url;
  }

  async deleteMedia(treeId: string, id: string): Promise<void> {
    const d = await this.doc(treeId);
    d.media = d.media.filter((m) => m.id !== id);
    d.persons = d.persons.map((p) => (p.avatar_media_id === id ? { ...p, avatar_media_id: null } : p));
    await idb.del(`blob:${id}`);
    await this.write(d);
  }

  async exportJson(treeId: string): Promise<BackupFile> {
    const d = await this.doc(treeId);
    const { owner_id: _owner, ...tree } = d.tree;
    void _owner;
    // Photos are embedded as data URLs so a local backup is complete on its own.
    const media = [];
    for (const m of d.media) {
      const blob = await idb.get<Blob>(`blob:${m.id}`);
      media.push({ ...m, data_url: blob ? await blobToDataUrl(blob) : null });
    }
    return {
      format: "roots-branches", version: 1, exported_at: now(),
      tree: tree as BackupFile["tree"],
      persons: d.persons, parent_child: d.parent_child, partnerships: d.partnerships, media,
    } as unknown as BackupFile;
  }

  async importJson(data: BackupFile, name?: string): Promise<string> {
    const { data: fresh } = remapIds(data);
    const tree = await this.createTree(name ?? data.tree.name);
    const d = await this.doc(tree.id);
    const withTree = <T extends object>(rows: T[]) => rows.map((r) => ({ ...r, tree_id: tree.id }));
    d.persons = withTree(fresh.persons as unknown as Person[]).map((p) => ({ ...emptyPerson(tree.id), ...p }));
    d.parent_child = withTree(fresh.parent_child as unknown as ParentChild[]);
    d.partnerships = withTree(fresh.partnerships as unknown as Partnership[]);
    d.media = [];
    for (const m of fresh.media as unknown as (Media & { data_url?: string | null })[]) {
      if (!m.data_url) continue;
      const blob = await (await fetch(m.data_url)).blob();
      const { data_url: _u, ...rest } = m;
      void _u;
      await idb.set(`blob:${m.id}`, blob);
      d.media.push({ ...rest, tree_id: tree.id, storage_path: `local/${m.id}`, is_copy: false });
    }
    const mediaIds = new Set(d.media.map((m) => m.id));
    d.persons = d.persons.map((p) => (p.avatar_media_id && !mediaIds.has(p.avatar_media_id) ? { ...p, avatar_media_id: null } : p));
    d.tree.root_person_id = fresh.tree.root_person_id ?? d.persons[0]?.id ?? null;
    await this.write(d);
    return tree.id;
  }

  async getEntryMode(): Promise<EntryMode> {
    return ((await idb.get<EntryMode>("entry_mode")) ?? "simple");
  }

  async setEntryMode(mode: EntryMode): Promise<void> {
    await idb.set("entry_mode", mode);
  }

  subscribe(treeId: string, onChange: () => void): () => void {
    const set = this.listeners.get(treeId) ?? new Set();
    set.add(onChange);
    this.listeners.set(treeId, set);
    return () => set.delete(onChange);
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
