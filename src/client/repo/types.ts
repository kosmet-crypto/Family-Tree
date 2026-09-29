// Data access used by the UI. Two implementations: local (IndexedDB) and cloud (Supabase).

import type { BackupFile } from "@/lib/backup/schema";
import type { EntryMode, Media, ParentChild, Partnership, Person, Tree, TreeRole } from "@/lib/types/db";

export interface TreeData {
  tree: Tree;
  role: TreeRole;
  persons: Person[];
  parentChild: ParentChild[];
  partnerships: Partnership[];
  media: Media[];
}

export type NewPerson = Partial<Person> & { tree_id: string };
export type NewParentChild = Omit<ParentChild, "id" | "created_at" | "updated_at" | "start_date" | "notes"> & Partial<Pick<ParentChild, "start_date" | "notes">>;
export type NewPartnership = Omit<Partnership, "id" | "created_at" | "updated_at" | "start_place" | "notes" | "sort_order"> & Partial<Pick<Partnership, "start_place" | "notes" | "sort_order">>;

export interface TreeSummary {
  id: string;
  name: string;
  role: TreeRole;
  updated_at: string;
  person_count?: number;
}

export interface Repo {
  readonly mode: "local" | "cloud";
  listTrees(): Promise<TreeSummary[]>;
  createTree(name: string): Promise<Tree>;
  updateTree(id: string, patch: Partial<Pick<Tree, "name" | "description" | "root_person_id" | "entry_mode">>): Promise<void>;
  deleteTree(id: string): Promise<void>;
  loadTree(id: string): Promise<TreeData>;

  savePerson(person: NewPerson): Promise<Person>;
  deletePerson(treeId: string, id: string): Promise<void>;
  addParentChild(edge: NewParentChild): Promise<ParentChild>;
  deleteParentChild(treeId: string, id: string): Promise<void>;
  addPartnership(p: NewPartnership): Promise<Partnership>;
  updatePartnership(treeId: string, id: string, patch: Partial<Partnership>): Promise<void>;
  deletePartnership(treeId: string, id: string): Promise<void>;

  uploadPhoto(treeId: string, personId: string, file: { blob: Blob; width: number; height: number; mimeType: string }): Promise<Media>;
  mediaUrl(media: Media): Promise<string>;
  deleteMedia(treeId: string, id: string): Promise<void>;

  exportJson(treeId: string): Promise<BackupFile>;
  importJson(data: BackupFile, name?: string): Promise<string>;

  getEntryMode(): Promise<EntryMode>;
  setEntryMode(mode: EntryMode): Promise<void>;

  /** Calls back when someone else changes the tree (cloud: Realtime). Returns unsubscribe. */
  subscribe(treeId: string, onChange: () => void): () => void;
}
