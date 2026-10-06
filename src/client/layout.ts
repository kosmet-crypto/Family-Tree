// Family tree layout: one row per generation, partners side by side, children centred under
// their parents. A light Sugiyama-style approach: order blocks by barycentre sweeps, then assign
// x coordinates that follow parents (down) and children (up) without overlaps.

import type { FamilyGraph } from "@/lib/graph/family-graph";
import type { Uuid } from "@/lib/types/db";

export const NODE_W = 184;
export const NODE_H = 76;
export const PARTNER_GAP = 36;
export const BLOCK_GAP = 48;
export const LEVEL_H = 190;

/** Family side relative to the root: -1 father's side, 1 mother's side, 0 root's own family. */
export type Side = -1 | 0 | 1;

export interface LayoutResult {
  positions: Map<Uuid, { x: number; y: number }>;
  generation: Map<Uuid, number>;
  side: Map<Uuid, Side>;
  width: number;
  height: number;
}

interface Block {
  members: Uuid[];
  x: number; // left edge
  order: number;
}

const sideOfBlock = (b: Block, side: Map<Uuid, Side>): Side => b.members.map((m) => side.get(m) ?? 0).find((x) => x !== 0) ?? 0;
const blockWidth = (b: Block) => b.members.length * NODE_W + (b.members.length - 1) * PARTNER_GAP;
const center = (b: Block) => b.x + blockWidth(b) / 2;

/**
 * Which side of the family each person belongs to, seen from the root: everyone descending from
 * (or married into) the father's ancestors is "father's side", likewise for the mother. The root's
 * parents, siblings, partner and descendants are the centre.
 */
export function familySides(graph: FamilyGraph, rootId?: Uuid | null): Map<Uuid, Side> {
  const side = new Map<Uuid, Side>();
  if (!rootId || !graph.person(rootId)) return side;
  const parents = graph.parents(rootId).map((e) => e.person);
  if (parents.length === 0) return side;
  const sorted = parents.slice().sort((a, b) => Number(b.gender === "male") - Number(a.gender === "male"));
  const roots: [Uuid | undefined, Side][] = parents.length === 1
    ? [[parents[0]!.gender === "male" ? parents[0]!.id : undefined, -1], [parents[0]!.gender === "male" ? undefined : parents[0]!.id, 1]]
    : [[sorted[0]!.id, -1], [sorted[1]!.id, 1]];
  const centre = new Set<Uuid>([rootId, ...graph.descendants(rootId).keys()]);
  for (const p of parents) for (const k of graph.descendants(p.id).keys()) centre.add(k); // siblings and their lines
  const claims = new Map<Uuid, Set<Side>>();
  const claim = (id: Uuid, sd: Side) => { (claims.get(id) ?? claims.set(id, new Set()).get(id)!).add(sd); };
  for (const [parentId, sd] of roots) {
    if (!parentId) continue;
    claim(parentId, sd);
    for (const [anc] of graph.ancestors(parentId)) {
      for (const id of [anc, ...graph.descendants(anc).keys()]) {
        if (!centre.has(id)) claim(id, sd);
      }
    }
  }
  // partners of a claimed person share the side (an uncle's wife is "father's side" too)
  for (const [id, set] of [...claims]) if (!parents.some((q) => q.id === id)) for (const { person } of graph.partners(id)) if (!centre.has(person.id) && !claims.has(person.id)) for (const sd of set) claim(person.id, sd);
  for (const p of parents) claims.delete(p.id); // the parents themselves stay in the middle
  for (const [id, set] of claims) side.set(id, set.size === 1 ? [...set][0]! : 0);
  return side;
}

export function layoutTree(graph: FamilyGraph, rootId?: Uuid | null): LayoutResult {
  const generation = graph.generations(rootId);
  const positions = new Map<Uuid, { x: number; y: number }>();
  const side = familySides(graph, rootId);
  if (generation.size === 0) return { positions, generation, side, width: 0, height: 0 };

  // Discovery order (DFS from the root, children by birth date) for a stable first ordering.
  const discovery = new Map<Uuid, number>();
  const visit = (id: Uuid) => {
    if (discovery.has(id)) return;
    discovery.set(id, discovery.size);
    for (const { person } of graph.partners(id)) visit(person.id);
    const kids = graph.children(id).map((e) => e.person)
      .sort((a, b) => (a.birth_date ?? "9999").localeCompare(b.birth_date ?? "9999"));
    for (const k of kids) visit(k.id);
    for (const p of graph.parents(id)) visit(p.person.id);
  };
  if (rootId && graph.person(rootId)) visit(rootId);
  for (const group of graph.components()) for (const id of group) visit(id);

  // Blocks: partners in the same generation are kept together.
  const levels = new Map<number, Block[]>();
  const blockOf = new Map<Uuid, Block>();
  const ids = [...generation.keys()].sort((a, b) => discovery.get(a)! - discovery.get(b)!);
  for (const id of ids) {
    if (blockOf.has(id)) continue;
    const g = generation.get(id)!;
    // collect the partner cluster in this generation
    const cluster: Uuid[] = [];
    const stack = [id];
    const seen = new Set<Uuid>([id]);
    while (stack.length) {
      const n = stack.pop()!;
      cluster.push(n);
      for (const { person } of graph.partners(n)) {
        if (!seen.has(person.id) && generation.get(person.id) === g && !blockOf.has(person.id)) {
          seen.add(person.id);
          stack.push(person.id);
        }
      }
    }
    const block: Block = { members: arrangeCouple(graph, cluster), x: 0, order: discovery.get(id)! };
    for (const m of block.members) blockOf.set(m, block);
    const list = levels.get(g) ?? [];
    list.push(block);
    levels.set(g, list);
  }

  const gens = [...levels.keys()].sort((a, b) => a - b);
  const sd = (b: Block) => sideOfBlock(b, side);
  for (const g of gens) levels.get(g)!.sort((a, b) => sd(a) - sd(b) || a.order - b.order);

  const parentIds = (b: Block) => b.members.flatMap((m) => graph.parentEdgesOf(m).map((e) => e.parent_id));
  const childIds = (b: Block) => b.members.flatMap((m) => graph.childEdgesOf(m).map((e) => e.child_id));
  const indexIn = (id: Uuid) => {
    const b = blockOf.get(id)!;
    const list = levels.get(generation.get(id)!)!;
    return list.indexOf(b) + b.members.indexOf(id) / (b.members.length + 1);
  };

  // 1. ordering sweeps (barycentre of neighbours in the adjacent level)
  for (let iter = 0; iter < 5; iter++) {
    const down = iter % 2 === 0;
    const seq = down ? gens.slice(1) : gens.slice(0, -1).reverse();
    for (const g of seq) {
      const list = levels.get(g)!;
      const bary = new Map<Block, number>();
      list.forEach((b, i) => {
        const neigh = (down ? parentIds(b) : childIds(b)).filter((n) => generation.get(n) === g + (down ? -1 : 1));
        bary.set(b, neigh.length ? neigh.reduce((s, n) => s + indexIn(n), 0) / neigh.length : i);
      });
      list.sort((a, b) => sd(a) - sd(b) || bary.get(a)! - bary.get(b)!);
    }
  }

  // 2. coordinates
  const xOf = (id: Uuid) => {
    const b = blockOf.get(id)!;
    return b.x + b.members.indexOf(id) * (NODE_W + PARTNER_GAP) + NODE_W / 2;
  };
  const place = (list: Block[], desired: (b: Block) => number | null) => {
    let right = -Infinity;
    const offsets: number[] = [];
    for (const b of list) {
      const want = desired(b);
      const w = blockWidth(b);
      const target = want === null ? right + BLOCK_GAP : want - w / 2;
      b.x = Math.max(target, right === -Infinity ? target : right + BLOCK_GAP);
      if (!Number.isFinite(b.x)) b.x = 0;
      right = b.x + w;
      if (want !== null) offsets.push(center(b) - want);
    }
    if (offsets.length) {
      offsets.sort((a, b) => a - b);
      const shift = offsets[Math.floor(offsets.length / 2)]!; // median keeps most blocks on target
      for (const b of list) b.x -= shift;
      // relax: move each block towards its wish, without touching its neighbours
      const wishes = list.map(desired);
      for (let pass = 0; pass < 8; pass++) {
        const order = pass % 2 === 0 ? list.map((_, i) => i) : list.map((_, i) => list.length - 1 - i);
        for (const i of order) {
          const want = wishes[i];
          if (want === null || want === undefined) continue;
          const b = list[i]!;
          const lo = i > 0 ? list[i - 1]!.x + blockWidth(list[i - 1]!) + BLOCK_GAP : -Infinity;
          const hi = i < list.length - 1 ? list[i + 1]!.x - BLOCK_GAP - blockWidth(b) : Infinity;
          b.x = Math.min(Math.max(want - blockWidth(b) / 2, lo), hi);
        }
      }
    }
  };
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);

  // initial: pack every level
  for (const g of gens) place(levels.get(g)!, () => null);
  for (let iter = 0; iter < 7; iter++) {
    const down = iter % 2 === 0;
    const seq = down ? gens.slice(1) : gens.slice(0, -1).reverse();
    for (const g of seq) {
      place(levels.get(g)!, (b) => {
        const neigh = (down ? parentIds(b) : childIds(b)).filter((n) => generation.get(n) === g + (down ? -1 : 1));
        return mean(neigh.map(xOf));
      });
    }
  }

  // 3. positions (top-left corners), normalised to start at 0,0
  const minGen = gens[0]!;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const [id, g] of generation) {
    const x = xOf(id) - NODE_W / 2;
    positions.set(id, { x, y: (g - minGen) * LEVEL_H });
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + NODE_W);
  }
  for (const p of positions.values()) p.x -= minX;
  return { positions, generation, side, width: maxX - minX, height: (gens.at(-1)! - minGen) * LEVEL_H + NODE_H };
}

/**
 * Orders a partner cluster: the person with most partners in the middle, partners alternating
 * right / left (first marriage on the right).
 */
function arrangeCouple(graph: FamilyGraph, cluster: Uuid[]): Uuid[] {
  if (cluster.length <= 2) {
    // keep the person with parents in the tree on the left for a stable look
    return cluster.slice().sort((a, b) => graph.parentEdgesOf(b).length - graph.parentEdgesOf(a).length);
  }
  const hub = cluster.slice().sort((a, b) => graph.partners(b).length - graph.partners(a).length)[0]!;
  const others = graph.partners(hub).map((p) => p.person.id).filter((id) => cluster.includes(id));
  const rest = cluster.filter((id) => id !== hub && !others.includes(id));
  const left: Uuid[] = [];
  const right: Uuid[] = [];
  others.forEach((id, i) => (i % 2 === 0 ? right : left).push(id));
  return [...left.reverse(), hub, ...right, ...rest];
}
