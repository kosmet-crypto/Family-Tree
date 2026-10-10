// Parent -> child links, drawn per family (the set of a child's parents) instead of per edge:
// every family gets its own horizontal bus at its own height and its own colour, and a couple's
// link starts between the two partners. Otherwise children of different couples that share a
// parent end up on one common line and look like siblings.

import type { FamilyGraph } from "@/lib/graph/family-graph";
import type { ParentRelation, Uuid } from "@/lib/types/db";
import { LEVEL_H, NODE_H, NODE_W, PARTNER_GAP, type LayoutResult } from "./layout";

export interface FamilyLink {
  id: string;
  /** the family's parents (1 or 2) and the child this link ends at */
  parents: Uuid[];
  child: Uuid;
  startX: number;
  startY: number;
  busY: number;
  endX: number;
  endY: number;
  /** colour index (cycled) shared by every link of the same family */
  tone: number;
  dashed: boolean;
}

const BUS_FIRST = 22;
const BUS_STEP = 18;
const BUS_LEVELS = Math.floor((LEVEL_H - NODE_H - BUS_FIRST - 14) / BUS_STEP) + 1;

export function familyLinks(graph: FamilyGraph, layout: LayoutResult): FamilyLink[] {
  const at = (id: Uuid) => layout.positions.get(id);
  // group children by parent set
  const families = new Map<string, { parents: Uuid[]; children: { id: Uuid; relation: ParentRelation }[] }>();
  for (const id of graph.persons.keys()) {
    const edges = graph.parentEdgesOf(id).filter((e) => at(e.parent_id));
    if (!edges.length || !at(id)) continue;
    const parents = [...new Set(edges.map((e) => e.parent_id))].sort();
    const key = parents.join("|");
    const fam = families.get(key) ?? families.set(key, { parents, children: [] }).get(key)!;
    fam.children.push({ id, relation: edges[0]!.relation });
  }

  // couples sit side by side; their link starts in the gap between the two cards
  const centreX = (p: Uuid) => at(p)!.x + NODE_W / 2;
  const isCouple = (a: Uuid, b: Uuid) =>
    graph.partnershipsOf(a).some((p) => p.person1_id === b || p.person2_id === b) &&
    at(a)!.y === at(b)!.y && Math.abs(at(a)!.x - at(b)!.x) <= NODE_W + PARTNER_GAP + 1;
  const anchor = (parents: Uuid[]) => {
    const [a, b] = parents;
    if (a && b && isCouple(a, b)) return { x: (centreX(a) + centreX(b)) / 2, y: at(a)!.y + NODE_H / 2, top: at(a)!.y };
    const p = parents[0]!;
    return { x: parents.length === 1 ? centreX(p) : parents.reduce((s, q) => s + centreX(q), 0) / parents.length, y: at(p)!.y + NODE_H, top: at(p)!.y };
  };

  // order families row by row, left to right; the bus level and the colour follow that order
  const list = [...families.values()].map((f) => ({ ...f, a: anchor(f.parents) }));
  list.sort((x, y) => x.a.top - y.a.top || x.a.x - y.a.x);
  const levelInRow = new Map<number, number>();
  const out: FamilyLink[] = [];
  list.forEach((f, i) => {
    const lvl = levelInRow.get(f.a.top) ?? 0;
    levelInRow.set(f.a.top, lvl + 1);
    const busY = f.a.top + NODE_H + BUS_FIRST + (lvl % BUS_LEVELS) * BUS_STEP;
    for (const c of f.children) {
      out.push({
        id: `${f.parents.join("+")}>${c.id}`, parents: f.parents, child: c.id,
        startX: f.a.x, startY: f.a.y, busY, endX: centreX(c.id), endY: at(c.id)!.y,
        tone: i % 6, dashed: c.relation !== "biological",
      });
    }
  });
  return out;
}

/** SVG path with rounded elbows: down from the parents, along the bus, down into the child. */
export function linkPath(l: FamilyLink, r = 10): string {
  const dir = Math.sign(l.endX - l.startX);
  const run = Math.abs(l.endX - l.startX);
  if (dir === 0 || run < 2 * r) return `M ${l.startX} ${l.startY} V ${l.busY} H ${l.endX} V ${l.endY}`;
  return [
    `M ${l.startX} ${l.startY}`, `V ${l.busY - r}`,
    `Q ${l.startX} ${l.busY} ${l.startX + dir * r} ${l.busY}`,
    `H ${l.endX - dir * r}`,
    `Q ${l.endX} ${l.busY} ${l.endX} ${l.busY + r}`,
    `V ${l.endY}`,
  ].join(" ");
}
