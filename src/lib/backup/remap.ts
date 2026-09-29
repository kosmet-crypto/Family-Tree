// Fresh ids for every row of a backup, so it can be imported next to the original.

import type { BackupFile } from "./schema";

export function remapIds(data: BackupFile, newId: () => string = () => crypto.randomUUID()): { data: BackupFile; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  const map = (id: string | null | undefined) => {
    if (!id) return id ?? null;
    let v = ids.get(id);
    if (!v) { v = newId(); ids.set(id, v); }
    return v;
  };
  const known = (id: string | null | undefined) => (id && ids.has(id) ? ids.get(id)! : null);
  const persons = data.persons.map((p) => ({ ...p, id: map(p.id)! }));
  const media = data.media.map((m) => ({ ...m, id: map(m.id)!, person_id: known(m.person_id) }));
  return {
    ids,
    data: {
      ...data,
      tree: { ...data.tree, root_person_id: known(data.tree.root_person_id) },
      persons: persons.map((p) => ({ ...p, avatar_media_id: known(p.avatar_media_id) })),
      parent_child: data.parent_child.map((e) => ({ ...e, id: map(e.id)!, parent_id: known(e.parent_id)!, child_id: known(e.child_id)! })),
      partnerships: data.partnerships.map((e) => ({ ...e, id: map(e.id)!, person1_id: known(e.person1_id)!, person2_id: known(e.person2_id)! })),
      media,
    },
  };
}

