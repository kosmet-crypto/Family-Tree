// In-memory family graph built from the rows of one tree.
// Nodes: persons. Edges: parent_child (directed) and partnerships (undirected).
// Used by the canvas, the generations list, validation and kinship labels.

import type {
  ParentChild,
  ParentRelation,
  Partnership,
  Person,
  SiblingType,
  Uuid,
} from "../types/db";

export interface ParentEdge {
  person: Person;
  relation: ParentRelation;
  edge: ParentChild;
}

export interface PartnerEdge {
  person: Person;
  partnership: Partnership;
}

export interface SiblingInfo {
  person: Person;
  type: SiblingType;
  sharedParentIds: Uuid[];
}

export interface GenerationGroup {
  generation: number;
  persons: Person[];
}

const BLOOD_LIKE: ReadonlySet<ParentRelation> = new Set(["biological", "adoptive"]);

export class FamilyGraph {
  readonly persons = new Map<Uuid, Person>();
  private readonly parentEdges = new Map<Uuid, ParentChild[]>(); // child -> edges to parents
  private readonly childEdges = new Map<Uuid, ParentChild[]>();  // parent -> edges to children
  private readonly partnerEdges = new Map<Uuid, Partnership[]>();

  constructor(
    persons: readonly Person[],
    private readonly parentChildRows: readonly ParentChild[] = [],
    private readonly partnershipRows: readonly Partnership[] = [],
  ) {
    const parentChild = parentChildRows;
    const partnerships = partnershipRows;
    for (const p of persons) this.persons.set(p.id, p);
    for (const e of parentChild) {
      if (!this.persons.has(e.parent_id) || !this.persons.has(e.child_id)) continue;
      push(this.parentEdges, e.child_id, e);
      push(this.childEdges, e.parent_id, e);
    }
    for (const pa of partnerships) {
      if (!this.persons.has(pa.person1_id) || !this.persons.has(pa.person2_id)) continue;
      push(this.partnerEdges, pa.person1_id, pa);
      push(this.partnerEdges, pa.person2_id, pa);
    }
  }

  /** A copy of the graph with one more (not yet saved) person, for validating a new entry. */
  withPerson(person: Person): FamilyGraph {
    return new FamilyGraph([...this.persons.values(), person], this.parentChildRows, this.partnershipRows);
  }

  person(id: Uuid): Person | undefined {
    return this.persons.get(id);
  }

  parentEdgesOf(id: Uuid): readonly ParentChild[] {
    return this.parentEdges.get(id) ?? [];
  }

  childEdgesOf(id: Uuid): readonly ParentChild[] {
    return this.childEdges.get(id) ?? [];
  }

  parents(id: Uuid, relations?: readonly ParentRelation[]): ParentEdge[] {
    return this.parentEdgesOf(id)
      .filter((e) => !relations || relations.includes(e.relation))
      .map((e) => ({ person: this.persons.get(e.parent_id)!, relation: e.relation, edge: e }));
  }

  children(id: Uuid, relations?: readonly ParentRelation[]): ParentEdge[] {
    return this.childEdgesOf(id)
      .filter((e) => !relations || relations.includes(e.relation))
      .map((e) => ({ person: this.persons.get(e.child_id)!, relation: e.relation, edge: e }));
  }

  /** Partners ordered by sort_order, then start date. */
  partners(id: Uuid): PartnerEdge[] {
    return (this.partnerEdges.get(id) ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order || (a.start_date ?? "").localeCompare(b.start_date ?? ""))
      .map((pa) => ({
        person: this.persons.get(pa.person1_id === id ? pa.person2_id : pa.person1_id)!,
        partnership: pa,
      }));
  }

  partnershipsOf(id: Uuid): readonly Partnership[] {
    return this.partnerEdges.get(id) ?? [];
  }

  /**
   * Siblings through shared parents (same rules as the SQL view person_siblings), plus
   * step-siblings through a parent's partner (the partner's children from another relationship).
   */
  siblings(id: Uuid): SiblingInfo[] {
    const result = new Map<Uuid, { bio: number; adoptive: boolean; shared: Uuid[] }>();
    for (const up of this.parentEdgesOf(id)) {
      for (const down of this.childEdgesOf(up.parent_id)) {
        if (down.child_id === id) continue;
        const entry = result.get(down.child_id) ?? { bio: 0, adoptive: false, shared: [] };
        if (up.relation === "biological" && down.relation === "biological") entry.bio += 1;
        if (up.relation === "adoptive" || down.relation === "adoptive") entry.adoptive = true;
        entry.shared.push(up.parent_id);
        result.set(down.child_id, entry);
      }
    }
    const out: SiblingInfo[] = [];
    for (const [sid, e] of result) {
      const type: SiblingType =
        e.bio >= 2 ? "full"
        : e.bio === 1 ? (this.hasOtherBioParent(id, sid) || this.hasOtherBioParent(sid, id) ? "half" : "full")
        : e.adoptive ? "adoptive" : "step";
      out.push({ person: this.persons.get(sid)!, type, sharedParentIds: e.shared });
    }
    // Step-siblings via marriage: children of my parents' partners who share no parent with me.
    const myParents = new Set(this.parentEdgesOf(id).map((e) => e.parent_id));
    for (const parentId of myParents) {
      for (const { person: partner } of this.partners(parentId)) {
        if (myParents.has(partner.id)) continue;
        for (const c of this.childEdgesOf(partner.id)) {
          if (c.child_id === id || result.has(c.child_id) || out.some((s) => s.person.id === c.child_id)) continue;
          out.push({ person: this.persons.get(c.child_id)!, type: "step", sharedParentIds: [] });
        }
      }
    }
    return out;
  }

  /**
   * a has a known biological parent that b does not have. Two siblings sharing their only known
   * parent are shown as full siblings (the other parent is just not entered yet).
   */
  hasOtherBioParent(a: Uuid, b: Uuid): boolean {
    const bParents = new Set(this.parentEdgesOf(b).filter((e) => e.relation === "biological").map((e) => e.parent_id));
    return this.parentEdgesOf(a).some((e) => e.relation === "biological" && !bParents.has(e.parent_id));
  }

  /** Ancestors with their (shortest) distance in generations. */
  ancestors(id: Uuid, maxDepth = 50, relations?: readonly ParentRelation[]): Map<Uuid, number> {
    return this.walk(id, maxDepth, (n) => this.parentEdgesOf(n).filter((e) => !relations || relations.includes(e.relation)).map((e) => e.parent_id));
  }

  /** Descendants with their (shortest) distance in generations. */
  descendants(id: Uuid, maxDepth = 50, relations?: readonly ParentRelation[]): Map<Uuid, number> {
    return this.walk(id, maxDepth, (n) => this.childEdgesOf(n).filter((e) => !relations || relations.includes(e.relation)).map((e) => e.child_id));
  }

  /** Blood-line ancestors (biological + adoptive), including the person at depth 0. */
  lineage(id: Uuid): Map<Uuid, number> {
    const m = this.ancestors(id, 50, [...BLOOD_LIKE]);
    m.set(id, 0);
    return m;
  }

  isAncestor(ancestorId: Uuid, personId: Uuid): boolean {
    return this.ancestors(personId).has(ancestorId);
  }

  /** Adding parentId -> childId would make someone their own ancestor. */
  wouldCreateCycle(parentId: Uuid, childId: Uuid): boolean {
    return parentId === childId || this.isAncestor(childId, parentId);
  }

  /**
   * A branch: the person, their descendants (or ancestors) and, optionally, those people's partners.
   * Used to highlight, collapse or export one line of the family.
   */
  branch(rootId: Uuid, direction: "descendants" | "ancestors" = "descendants", withPartners = true): Set<Uuid> {
    const core = direction === "descendants" ? this.descendants(rootId) : this.ancestors(rootId);
    const ids = new Set<Uuid>([rootId, ...core.keys()]);
    if (withPartners) {
      for (const id of [...ids]) for (const { person } of this.partners(id)) ids.add(person.id);
    }
    return ids;
  }

  /** Connected groups of people (a tree may contain unlinked families). Largest first. */
  components(): Uuid[][] {
    const seen = new Set<Uuid>();
    const groups: Uuid[][] = [];
    for (const start of this.persons.keys()) {
      if (seen.has(start)) continue;
      const group: Uuid[] = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const n = stack.pop()!;
        group.push(n);
        for (const m of this.neighbours(n)) {
          if (!seen.has(m)) { seen.add(m); stack.push(m); }
        }
      }
      groups.push(group);
    }
    return groups.sort((a, b) => b.length - a.length);
  }

  /**
   * Generation number per person relative to rootId (root = 0, parents = -1, children = +1,
   * partners = same). People not connected to the root get numbers relative to their own
   * component's oldest known person. First assignment wins when paths disagree.
   */
  generations(rootId?: Uuid | null): Map<Uuid, number> {
    const gen = new Map<Uuid, number>();
    const assign = (start: Uuid) => {
      gen.set(start, 0);
      const queue: Uuid[] = [start];
      while (queue.length) {
        const n = queue.shift()!;
        const g = gen.get(n)!;
        const next: Array<[Uuid, number]> = [
          ...this.parentEdgesOf(n).map((e): [Uuid, number] => [e.parent_id, g - 1]),
          ...this.childEdgesOf(n).map((e): [Uuid, number] => [e.child_id, g + 1]),
          ...(this.partnerEdges.get(n) ?? []).map((p): [Uuid, number] => [p.person1_id === n ? p.person2_id : p.person1_id, g]),
        ];
        for (const [m, mg] of next) {
          if (!gen.has(m)) { gen.set(m, mg); queue.push(m); }
        }
      }
    };
    if (rootId && this.persons.has(rootId)) assign(rootId);
    for (const group of this.components()) {
      if (group.some((id) => gen.has(id))) continue;
      assign(group[0]!);
      // shift so the oldest generation in this component is 0
      const min = Math.min(...group.map((id) => gen.get(id)!));
      for (const id of group) gen.set(id, gen.get(id)! - min);
    }
    return gen;
  }

  /** People grouped by generation (oldest first), for the list view. */
  generationGroups(rootId?: Uuid | null): GenerationGroup[] {
    const gen = this.generations(rootId);
    const groups = new Map<number, Person[]>();
    for (const [id, g] of gen) push(groups, g, this.persons.get(id)!);
    return [...groups.entries()]
      .sort(([a], [b]) => a - b)
      .map(([generation, persons]) => ({
        generation,
        persons: persons.sort(
          (a, b) => (a.birth_date ?? "9999").localeCompare(b.birth_date ?? "9999") || a.first_name.localeCompare(b.first_name),
        ),
      }));
  }

  private neighbours(id: Uuid): Uuid[] {
    return [
      ...this.parentEdgesOf(id).map((e) => e.parent_id),
      ...this.childEdgesOf(id).map((e) => e.child_id),
      ...(this.partnerEdges.get(id) ?? []).map((p) => (p.person1_id === id ? p.person2_id : p.person1_id)),
    ];
  }

  private walk(id: Uuid, maxDepth: number, next: (n: Uuid) => Uuid[]): Map<Uuid, number> {
    const depth = new Map<Uuid, number>();
    let frontier = [id];
    for (let d = 1; d <= maxDepth && frontier.length; d++) {
      const nextFrontier: Uuid[] = [];
      for (const n of frontier) {
        for (const m of next(n)) {
          if (m === id || depth.has(m)) continue;
          depth.set(m, d);
          nextFrontier.push(m);
        }
      }
      frontier = nextFrontier;
    }
    return depth;
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
