// Relationship between two people ("Who is B to A?") with Serbian and English labels.
// Blood/adoptive relations go through the closest common ancestor; one marriage step
// gives in-laws (таст, свекрва, зет, снаха, девер, шурак, заова, свастика ...).

import type { Gender, ParentRelation, Uuid } from "../types/db";
import type { FamilyGraph } from "./family-graph";

export type Kinship =
  | { kind: "self" }
  | { kind: "parent"; relation: ParentRelation }
  | { kind: "child"; relation: ParentRelation }
  | { kind: "blood"; up: number; down: number; half: boolean; viaGender: Gender; siblingGender: Gender }
  | { kind: "spouse"; former: boolean }
  | { kind: "in_law"; key: InLawKey }
  | { kind: "none" };

export type InLawKey =
  | "spouse_parent"      // таст/ташта, свекар/свекрва
  | "child_spouse"       // зет, снаха
  | "spouse_sibling"     // шурак/свастика, девер/заова
  | "sibling_spouse"     // зет, снаха
  | "parent_spouse";     // очух, маћеха (partner of a parent, no parent edge)

/** B's relationship to A (answers: "B is A's ...") */
export function kinship(graph: FamilyGraph, aId: Uuid, bId: Uuid): Kinship {
  if (aId === bId) return { kind: "self" };
  const a = graph.person(aId);
  const b = graph.person(bId);
  if (!a || !b) return { kind: "none" };

  const direct = graph.parentEdgesOf(aId).find((e) => e.parent_id === bId);
  if (direct) return { kind: "parent", relation: direct.relation };
  const directChild = graph.childEdgesOf(aId).find((e) => e.child_id === bId);
  if (directChild) return { kind: "child", relation: directChild.relation };

  const blood = bloodKinship(graph, aId, bId);
  if (blood) return blood;

  const partnership = graph.partnershipsOf(aId).find((p) => p.person1_id === bId || p.person2_id === bId);
  if (partnership) return { kind: "spouse", former: partnership.status !== "active" && partnership.status !== "widowed" };

  // B is a relative of A's partner
  for (const { person: spouse } of graph.partners(aId)) {
    if (graph.parentEdgesOf(spouse.id).some((e) => e.parent_id === bId)) return { kind: "in_law", key: "spouse_parent" };
    const k = bloodKinship(graph, spouse.id, bId);
    if (k && k.kind === "blood" && k.up === 1 && k.down === 1) return { kind: "in_law", key: "spouse_sibling" };
  }
  // B is the partner of A's relative
  for (const { person: partner } of graph.partners(bId)) {
    if (graph.childEdgesOf(aId).some((e) => e.child_id === partner.id)) return { kind: "in_law", key: "child_spouse" };
    if (graph.parentEdgesOf(aId).some((e) => e.parent_id === partner.id)) return { kind: "in_law", key: "parent_spouse" };
    const k = bloodKinship(graph, aId, partner.id);
    if (k && k.kind === "blood" && k.up === 1 && k.down === 1) return { kind: "in_law", key: "sibling_spouse" };
  }
  return { kind: "none" };
}

function bloodKinship(graph: FamilyGraph, aId: Uuid, bId: Uuid): Kinship | null {
  const la = graph.lineage(aId);
  const lb = graph.lineage(bId);
  let best: { up: number; down: number; ancestor: Uuid } | null = null;
  for (const [id, up] of la) {
    const down = lb.get(id);
    if (down === undefined) continue;
    if (!best || up + down < best.up + best.down || (up + down === best.up + best.down && up < best.up)) {
      best = { up, down, ancestor: id };
    }
  }
  if (!best) return null;

  // Half relation: the two lines meet in only one of a couple (only matters for siblings / their lines).
  const commonAtLevel = [...la].filter(([id, up]) => up === best!.up && lb.get(id) === best!.down).length;
  // Only called "half" when a second, different parent is actually known on one side.
  const half = best.up === 1 && best.down === 1 && commonAtLevel < 2
    && (graph.hasOtherBioParent(aId, bId) || graph.hasOtherBioParent(bId, aId));

  // Gender of A's parent on the path (стриц vs ујак) and of B's parent on the path (синовац vs сестрић).
  const viaGender = best.up >= 2 ? parentOnPath(graph, aId, best.ancestor, best.up)?.gender ?? "unknown" : "unknown";
  const siblingGender = best.down >= 2 ? parentOnPath(graph, bId, best.ancestor, best.down)?.gender ?? "unknown" : "unknown";
  return { kind: "blood", up: best.up, down: best.down, half, viaGender, siblingGender };
}

/** The parent of `fromId` that lies on a blood line to `ancestor`, which is `depth` generations up. */
function parentOnPath(graph: FamilyGraph, fromId: Uuid, ancestor: Uuid, depth: number) {
  for (const e of graph.parentEdgesOf(fromId)) {
    if (e.relation !== "biological" && e.relation !== "adoptive") continue;
    if (depth === 1 ? e.parent_id === ancestor : graph.lineage(e.parent_id).get(ancestor) === depth - 1) {
      return graph.person(e.parent_id);
    }
  }
  return undefined;
}
