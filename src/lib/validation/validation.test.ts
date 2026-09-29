import { FamilyGraph } from "../graph/family-graph";
import { edge, family, makePerson, marriage } from "../test/fixtures";
import { issueFromDbError, issueMessage } from "./issues";
import { validatePerson } from "./person";
import { validateParentChild, validatePartnership } from "./relations";

const codes = (r: { errors: { code: string }[]; warnings: { code: string }[] }) => ({
  errors: r.errors.map((i) => i.code),
  warnings: r.warnings.map((i) => i.code),
});

describe("validatePerson", () => {
  const today = new Date("2026-09-29T12:00:00Z");

  it("accepts a simple person and drops complex-only fields in simple mode", () => {
    const r = validatePerson({ first_name: " Marko ", birth_date: "1990-03-03", notes: "tajna", nickname: "Mare" }, "simple", today);
    expect(r.ok).toBe(true);
    expect(r.payload?.first_name).toBe("Marko");
    expect(r.payload).not.toHaveProperty("notes");
    expect(r.payload).not.toHaveProperty("nickname");
    const c = validatePerson({ first_name: "Marko", notes: "tajna" }, "complex", today);
    expect(c.payload?.notes).toBe("tajna");
  });

  it("requires a name (nickname is enough in complex mode)", () => {
    expect(codes(validatePerson({ first_name: "" }, "simple", today)).errors).toEqual(["name_required"]);
    expect(validatePerson({ first_name: "", nickname: "Deda" }, "complex", today).ok).toBe(true);
  });

  it("rejects invalid, future and inconsistent dates", () => {
    expect(codes(validatePerson({ first_name: "A", birth_date: "1990-02-30" }, "simple", today)).errors).toEqual(["invalid_date"]);
    expect(codes(validatePerson({ first_name: "A", birth_date: "2027-01-01" }, "simple", today)).errors).toEqual(["date_in_future"]);
    expect(codes(validatePerson({ first_name: "A", is_living: true, death_date: "2000-01-01" }, "simple", today)).errors)
      .toEqual(["living_with_death_date"]);
    expect(codes(validatePerson({ first_name: "A", is_living: false, birth_date: "1950-01-01", death_date: "1940-01-01" }, "simple", today)).errors)
      .toEqual(["death_before_birth"]);
  });

  it("does not flag approximate dates that may be consistent", () => {
    const r = validatePerson({
      first_name: "A", is_living: false,
      birth_date: "1930-01-01", birth_date_precision: "about",
      death_date: "1929-06-01", death_date_precision: "exact",
    }, "simple", today);
    expect(r.ok).toBe(true);
  });

  it("warns about implausible ages", () => {
    expect(codes(validatePerson({ first_name: "A", birth_date: "1890-01-01" }, "simple", today)).warnings).toEqual(["implausible_age"]);
  });
});

describe("validateParentChild", () => {
  const { p, graph } = family();

  it("blocks self, cycles, duplicates and a third biological parent", () => {
    expect(codes(validateParentChild(graph, { parent_id: p.marko.id, child_id: p.marko.id, relation: "biological" })).errors).toEqual(["self_relation"]);
    expect(codes(validateParentChild(graph, { parent_id: p.maja.id, child_id: p.milan.id, relation: "adoptive" })).errors).toContain("cycle");
    expect(codes(validateParentChild(graph, { parent_id: p.jovan.id, child_id: p.marko.id, relation: "biological" })).errors).toEqual(["duplicate_relation"]);
    expect(codes(validateParentChild(graph, { parent_id: p.sanja.id, child_id: p.marko.id, relation: "biological" })).errors).toEqual(["too_many_biological_parents"]);
  });

  it("allows a step / adoptive parent next to two biological ones", () => {
    expect(validateParentChild(graph, { parent_id: p.sanja.id, child_id: p.marko.id, relation: "step" }).ok).toBe(true);
  });

  it("checks ages at birth", () => {
    const g = new FamilyGraph([
      makePerson("Kid", "male", "2000-01-01"),
      makePerson("Young", "female", "1992-01-01"),
      makePerson("Old", "male", "1910-01-01"),
      makePerson("Later", "male", "2001-01-01"),
    ]);
    const [kid, young, old, later] = [...g.persons.values()];
    expect(codes(validateParentChild(g, { parent_id: later!.id, child_id: kid!.id, relation: "biological" })).errors).toEqual(["parent_younger_than_child"]);
    expect(codes(validateParentChild(g, { parent_id: young!.id, child_id: kid!.id, relation: "biological" })).warnings).toEqual(["parent_too_young"]);
    expect(codes(validateParentChild(g, { parent_id: old!.id, child_id: kid!.id, relation: "biological" })).warnings).toEqual(["parent_too_old"]);
  });

  it("warns when a child is born after the parent's death (fathers get ~10 months)", () => {
    const kid = makePerson("Kid", "male", "2000-06-01");
    const dad = makePerson("Dad", "male", "1970-01-01", { is_living: false, death_date: "2000-01-01" });
    const mom = makePerson("Mom", "female", "1972-01-01", { is_living: false, death_date: "2000-01-01" });
    const g = new FamilyGraph([kid, dad, mom]);
    expect(validateParentChild(g, { parent_id: dad.id, child_id: kid.id, relation: "biological" }).warnings).toEqual([]);
    expect(codes(validateParentChild(g, { parent_id: mom.id, child_id: kid.id, relation: "biological" })).warnings).toEqual(["born_after_parent_death"]);
  });

  it("warns about two biological parents of the same gender", () => {
    const kid = makePerson("Kid", "male", "2000-01-01");
    const a = makePerson("A", "male", "1970-01-01");
    const b = makePerson("B", "male", "1971-01-01");
    const g = new FamilyGraph([kid, a, b], [edge(a, kid)]);
    expect(codes(validateParentChild(g, { parent_id: b.id, child_id: kid.id, relation: "biological" })).warnings).toEqual(["same_gender_biological_parents"]);
  });

  it("rejects people from different trees", () => {
    const stranger = makePerson("X", "male", null, { tree_id: "00000000-0000-4000-8000-00000000ffff" });
    const g = new FamilyGraph([...graph.persons.values(), stranger]);
    expect(codes(validateParentChild(g, { parent_id: stranger.id, child_id: p.marko.id, relation: "biological" })).errors).toEqual(["different_tree"]);
  });
});

describe("validatePartnership", () => {
  const { p, graph, partnerships } = family();
  const base = { kind: "marriage" as const, status: "active" as const };

  it("blocks close blood relatives and warns for cousins", () => {
    expect(codes(validatePartnership(graph, { ...base, person1_id: p.jovan.id, person2_id: p.vesna.id })).errors).toEqual(["partner_is_blood_relative"]);
    expect(codes(validatePartnership(graph, { ...base, person1_id: p.milan.id, person2_id: p.maja.id })).errors).toEqual(["partner_is_blood_relative"]);
    const cousins = validatePartnership(graph, { ...base, person1_id: p.marko.id, person2_id: p.ana.id });
    expect(cousins.ok).toBe(true);
    expect(cousins.warnings[0]?.params?.relation).toBe("сестра од тетке");
  });

  it("blocks a duplicate active marriage and warns about an overlapping one", () => {
    expect(codes(validatePartnership(graph, { ...base, person1_id: p.sanja.id, person2_id: p.jovan.id })).errors).toEqual(["duplicate_active_partnership"]);
    expect(codes(validatePartnership(graph, { ...base, person1_id: p.jovan.id, person2_id: p.ana.id })).warnings).toContain("overlapping_marriage");
    // editing the existing marriage itself is fine
    const existing = partnerships.find((x) => x.status === "active" && [x.person1_id, x.person2_id].includes(p.sanja.id))!;
    expect(validatePartnership(graph, { ...base, id: existing.id, person1_id: p.jovan.id, person2_id: p.sanja.id }).ok).toBe(true);
    // remarrying the divorced wife is allowed (with an overlap warning because Sanja is still active)
    expect(validatePartnership(graph, { ...base, person1_id: p.jovan.id, person2_id: p.jelena.id }).ok).toBe(true);
  });

  it("checks dates", () => {
    const r = validatePartnership(graph, { ...base, status: "divorced", person1_id: p.rade.id, person2_id: p.jelena.id, start_date: "1970-01-01", end_date: "1969-01-01" });
    expect(codes(r).errors).toEqual(["end_before_start"]);
    expect(codes(validatePartnership(graph, { ...base, person1_id: p.nikola.id, person2_id: p.loner.id, start_date: "2010-01-01" })).warnings).toEqual(["partner_too_young"]);
    const dead = new FamilyGraph([
      makePerson("A", "male", "1900-01-01", { is_living: false, death_date: "1950-01-01" }),
      makePerson("B", "female", "1905-01-01"),
    ], [], [marriage(makePerson("x", "male", null), makePerson("y", "male", null))]);
    const [a, b] = [...dead.persons.values()];
    expect(codes(validatePartnership(dead, { ...base, person1_id: a!.id, person2_id: b!.id, start_date: "1960-01-01" })).warnings).toEqual(["partnership_after_death"]);
  });
});

describe("issues", () => {
  it("maps database errors raised by triggers", () => {
    expect(issueFromDbError({ hint: "cycle" })).toBe("cycle");
    expect(issueFromDbError({ code: "23505", message: 'duplicate key value violates unique constraint "parent_child_unique"' })).toBe("duplicate_relation");
    expect(issueFromDbError({ code: "XX000" })).toBeNull();
  });

  it("formats messages with params", () => {
    expect(issueMessage({ code: "parent_too_young", severity: "warning", params: { age: 9 } })).toBe("Родитељ би имао само 9 год. при рођењу детета.");
    expect(issueMessage({ code: "cycle", severity: "error" }, "en")).toBe("This would make the person their own ancestor.");
  });
});
