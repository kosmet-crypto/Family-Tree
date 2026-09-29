import { FamilyGraph } from "@/lib/graph/family-graph";
import { edge, family, makePerson, marriage } from "@/lib/test/fixtures";
import { layoutTree, LEVEL_H, NODE_W, PARTNER_GAP } from "./layout";

describe("layoutTree", () => {
  const { p, graph } = family();
  const { positions } = layoutTree(graph, p.marko.id);
  const pos = (k: keyof typeof p) => positions.get(p[k].id)!;
  const cx = (k: keyof typeof p) => pos(k).x + NODE_W / 2;

  it("places everyone, one row per generation", () => {
    expect(positions.size).toBe(Object.keys(p).length);
    expect(pos("jovan").y).toBe(pos("marko").y - LEVEL_H);
    expect(pos("milan").y).toBe(pos("jovan").y - LEVEL_H);
    expect(pos("maja").y).toBe(pos("marko").y + LEVEL_H);
  });

  it("never overlaps nodes in a row", () => {
    const rows = new Map<number, number[]>();
    for (const q of positions.values()) rows.set(q.y, [...(rows.get(q.y) ?? []), q.x]);
    for (const xs of rows.values()) {
      xs.sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(NODE_W + PARTNER_GAP - 0.001);
    }
  });

  it("keeps partners next to each other", () => {
    expect(Math.abs(pos("vesna").x - pos("petar").x)).toBe(NODE_W + PARTNER_GAP);
    expect(Math.abs(pos("milan").x - pos("mira").x)).toBe(NODE_W + PARTNER_GAP);
    // Jovan between his two wives
    const xs = [pos("jelena").x, pos("jovan").x, pos("sanja").x].sort((a, b) => a - b);
    expect(xs[1]).toBe(pos("jovan").x);
  });

  it("centres an only child under the parents", () => {
    const parentsCenter = (cx("vesna") + cx("petar")) / 2;
    expect(Math.abs(cx("ana") - parentsCenter)).toBeLessThan(1);
    expect(Math.abs(cx("maja") - cx("marko"))).toBeLessThan(1);
  });

  it("handles an empty tree and a single person", () => {
    expect(layoutTree(new FamilyGraph([])).positions.size).toBe(0);
    const solo = makePerson("Solo", "male", null);
    expect(layoutTree(new FamilyGraph([solo]), solo.id).positions.get(solo.id)).toEqual({ x: 0, y: 0 });
  });

  it("lays out a large tree quickly", () => {
    const people = [makePerson("Root", "male", "1800-01-01")];
    const edges = [];
    const partners = [];
    for (let i = 0; i < 400; i++) {
      const parent = people[Math.floor(i / 3)]!;
      const child = makePerson(`C${i}`, i % 2 ? "male" : "female", null);
      const spouse = makePerson(`S${i}`, "unknown", null);
      people.push(child, spouse);
      edges.push(edge(parent, child));
      partners.push(marriage(child, spouse));
    }
    const t = performance.now();
    const r = layoutTree(new FamilyGraph(people, edges, partners), people[0]!.id);
    expect(r.positions.size).toBe(801);
    expect(performance.now() - t).toBeLessThan(2000);
  });
});
