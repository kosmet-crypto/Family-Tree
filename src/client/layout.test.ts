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
    expect(Math.abs(cx("ana") - parentsCenter)).toBeLessThan(20); // rows are split by family side, so a cousin may sit slightly off
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

describe("family sides", () => {
  // Root R, father F (parents GF1+GW1, F's brother UF), mother M (parents GF2+GW2, M's sister AM)
  const mk = (n: string, g: "male" | "female") => makePerson(n, g, null);
  const R = mk("R", "male"), F = mk("F", "male"), M = mk("M", "female"), SIB = mk("Sib", "female");
  const GF1 = mk("GF1", "male"), GW1 = mk("GW1", "female"), UF = mk("UF", "male");
  const GF2 = mk("GF2", "male"), GW2 = mk("GW2", "female"), AM = mk("AM", "female");
  const persons = [R, F, M, SIB, GF1, GW1, UF, GF2, GW2, AM];
  const edges = [edge(F, R), edge(M, R), edge(F, SIB), edge(M, SIB), edge(GF1, F), edge(GW1, F), edge(GF1, UF), edge(GW1, UF),
    edge(GF2, M), edge(GW2, M), edge(GF2, AM), edge(GW2, AM)];
  const graph = new FamilyGraph(persons, edges, [marriage(F, M), marriage(GF1, GW1), marriage(GF2, GW2)]);
  const res = layoutTree(graph, R.id);

  it("classifies relatives by the parent they come through", () => {
    expect(res.side.get(UF.id)).toBe(-1);
    expect(res.side.get(GW1.id)).toBe(-1);
    expect(res.side.get(AM.id)).toBe(1);
    expect(res.side.get(GF2.id)).toBe(1);
    expect(res.side.get(SIB.id) ?? 0).toBe(0);
    expect(res.side.get(F.id) ?? 0).toBe(0);
  });

  it("puts father's relatives on the left and mother's on the right", () => {
    const x = (q: typeof R) => res.positions.get(q.id)!.x;
    expect(x(UF)).toBeLessThan(x(F));
    expect(x(AM)).toBeGreaterThan(x(M));
    expect(x(GF1)).toBeLessThan(x(GF2));
    expect(Math.max(x(UF), x(GF1), x(GW1))).toBeLessThan(Math.min(x(AM), x(GF2), x(GW2)));
  });
});
