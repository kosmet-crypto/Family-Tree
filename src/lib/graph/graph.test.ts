import { family } from "../test/fixtures";
import { kinship } from "./kinship";
import { kinshipLabel, type KinshipLocale } from "./kinship-labels";

const { p, graph } = family();

const label = (a: keyof typeof p, b: keyof typeof p, locale: KinshipLocale = "sr") =>
  kinshipLabel(kinship(graph, p[a].id, p[b].id), p[b].gender, p[a].gender, locale);

describe("FamilyGraph", () => {
  it("finds parents and children", () => {
    expect(graph.parents(p.marko.id).map((e) => e.person.first_name).sort()).toEqual(["Jelena", "Jovan"]);
    expect(graph.children(p.jovan.id).map((e) => e.person.first_name).sort()).toEqual(["Marko", "Nikola"]);
  });

  it("classifies siblings", () => {
    const of = (id: string) => Object.fromEntries(graph.siblings(id).map((s) => [s.person.first_name, s.type]));
    expect(of(p.jovan.id)).toEqual({ Vesna: "full" });
    expect(of(p.marko.id)).toEqual({ Nikola: "half", Luka: "step" });
    expect(of(p.nikola.id)).toEqual({ Marko: "half", Luka: "half" });
  });

  it("walks ancestors and descendants with depth", () => {
    const anc = graph.ancestors(p.marko.id);
    expect(anc.get(p.jovan.id)).toBe(1);
    expect(anc.get(p.milan.id)).toBe(2);
    expect(anc.get(p.staro.id)).toBe(3);
    expect(anc.get(p.dragan.id)).toBe(2);
    expect(anc.size).toBe(7);
    expect(graph.descendants(p.milan.id).size).toBe(6);
  });

  it("detects cycles", () => {
    expect(graph.wouldCreateCycle(p.maja.id, p.milan.id)).toBe(true);
    expect(graph.wouldCreateCycle(p.marko.id, p.marko.id)).toBe(true);
    expect(graph.wouldCreateCycle(p.milan.id, p.maja.id)).toBe(false);
  });

  it("assigns generations and groups them for the list view", () => {
    const gen = graph.generations(p.marko.id);
    expect(gen.get(p.marko.id)).toBe(0);
    expect(gen.get(p.jovan.id)).toBe(-1);
    expect(gen.get(p.sanja.id)).toBe(-1);
    expect(gen.get(p.milan.id)).toBe(-2);
    expect(gen.get(p.staro.id)).toBe(-3);
    expect(gen.get(p.maja.id)).toBe(1);
    expect(gen.get(p.loner.id)).toBe(0);
    const groups = graph.generationGroups(p.marko.id);
    expect(groups[0]!.generation).toBe(-3);
    expect(groups.at(-1)!.persons.map((x) => x.first_name)).toEqual(["Maja"]);
  });

  it("splits unconnected people into components", () => {
    const comps = graph.components();
    expect(comps).toHaveLength(2);
    expect(comps[1]).toEqual([p.loner.id]);
  });

  it("extracts a branch with partners", () => {
    const names = [...graph.branch(p.jovan.id)].map((id) => graph.person(id)!.first_name).sort();
    expect(names).toEqual(["Jelena", "Jovan", "Maja", "Marko", "Nikola", "Sanja"]);
  });
});

describe("kinship labels (sr)", () => {
  it.each([
    ["marko", "jovan", "отац"],
    ["jovan", "marko", "син"],
    ["marko", "milan", "деда"],
    ["marko", "staro", "прадеда"],
    ["jovan", "maja", "унука"],
    ["marko", "vesna", "тетка"],
    ["jovan", "stevan", "ујак"],
    ["jovan", "rade", "стриц"],
    ["vesna", "marko", "синовац"],
    ["marko", "ana", "сестра од тетке"],
    ["ana", "marko", "брат од ујака"],
    ["marko", "nikola", "полубрат"],
    ["jovan", "vesna", "сестра"],
    ["jovan", "sanja", "жена"],
    ["jovan", "jelena", "бивша жена"],
    ["jovan", "dragan", "таст"],
    ["sanja", "milan", "свекар"],
    ["sanja", "vesna", "заова"],
    ["milan", "sanja", "снаха"],
    ["jovan", "petar", "зет"],
    ["marko", "sanja", "маћеха"],
    ["marko", "loner", "нема познате везе"],
  ] as const)("%s → %s = %s", (a, b, expected) => {
    expect(label(a, b)).toBe(expected);
  });

  it("latin and english", () => {
    expect(label("marko", "nikola", "sr-Latn")).toBe("polubrat");
    expect(label("jovan", "stevan", "sr-Latn")).toBe("ujak");
    expect(label("marko", "ana", "en")).toBe("first cousin");
    expect(label("marko", "staro", "en")).toBe("great-grandfather");
    expect(label("vesna", "maja", "en")).toBe("great-niece");
  });
});
