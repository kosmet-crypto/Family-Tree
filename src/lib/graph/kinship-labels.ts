// Human labels for kinship(): Serbian (Cyrillic / Latin) and English.

import { cyrillicToLatin } from "../search";
import type { Gender, ParentRelation } from "../types/db";
import type { Kinship } from "./kinship";

export type KinshipLocale = "sr" | "sr-Latn" | "en";

/** [male, female, unknown] */
type G = readonly [string, string, string];

const pick = (g: G, gender: Gender) => (gender === "male" ? g[0] : gender === "female" ? g[1] : g[2]);

const SR = {
  parent: {
    biological: ["отац", "мајка", "родитељ"],
    adoptive: ["усвојитељ", "усвојитељка", "усвојитељ"],
    step: ["очух", "маћеха", "очух/маћеха"],
    foster: ["хранитељ", "хранитељка", "хранитељ"],
    guardian: ["старатељ", "старатељка", "старатељ"],
  } satisfies Record<ParentRelation, G>,
  child: {
    biological: ["син", "ћерка", "дете"],
    adoptive: ["усвојени син", "усвојена ћерка", "усвојено дете"],
    step: ["пасторак", "пасторка", "пасторче"],
    foster: ["хранитељски син", "хранитељска ћерка", "хранитељско дете"],
    guardian: ["штићеник", "штићеница", "штићеник"],
  } satisfies Record<ParentRelation, G>,
  up: [null, null, ["деда", "баба", "деда/баба"], ["прадеда", "прабаба", "прадеда/прабаба"],
    ["чукундеда", "чукунбаба", "чукундеда/чукунбаба"], ["наврдеда", "наврбаба", "наврдеда/наврбаба"]] as (G | null)[],
  down: [null, null, ["унук", "унука", "унуче"], ["праунук", "праунука", "праунуче"],
    ["чукунунук", "чукунунука", "чукунунуче"]] as (G | null)[],
  ancestor: (n: number) => `предак (${n}. колено)`,
  descendant: (n: number) => `потомак (${n}. колено)`,
  sibling: ["брат", "сестра", "брат/сестра"] as G,
  halfSibling: ["полубрат", "полусестра", "полубрат/полусестра"] as G,
  cousinN: (n: number, g: Gender) => `${g === "female" ? "рођака" : "рођак"} (${n}. степена)`,
  relative: ["рођак", "рођака", "рођак"] as G,
  spouse: ["муж", "жена", "супружник"] as G,
  exSpouse: ["бивши муж", "бивша жена", "бивши супружник"] as G,
  none: "нема познате везе",
  self: "ја",
};

const EN = {
  parent: {
    biological: ["father", "mother", "parent"],
    adoptive: ["adoptive father", "adoptive mother", "adoptive parent"],
    step: ["stepfather", "stepmother", "step-parent"],
    foster: ["foster father", "foster mother", "foster parent"],
    guardian: ["guardian", "guardian", "guardian"],
  } satisfies Record<ParentRelation, G>,
  child: {
    biological: ["son", "daughter", "child"],
    adoptive: ["adopted son", "adopted daughter", "adopted child"],
    step: ["stepson", "stepdaughter", "stepchild"],
    foster: ["foster son", "foster daughter", "foster child"],
    guardian: ["ward", "ward", "ward"],
  } satisfies Record<ParentRelation, G>,
  sibling: ["brother", "sister", "sibling"] as G,
  halfSibling: ["half-brother", "half-sister", "half-sibling"] as G,
  uncle: ["uncle", "aunt", "uncle/aunt"] as G,
  nephew: ["nephew", "niece", "nephew/niece"] as G,
  spouse: ["husband", "wife", "spouse"] as G,
  exSpouse: ["ex-husband", "ex-wife", "ex-spouse"] as G,
};

const ORD_EN = ["", "first", "second", "third", "fourth", "fifth", "sixth"];

/**
 * @param k      result of kinship(graph, a, b)
 * @param bGender gender of B (the person being described)
 * @param aGender gender of A (needed for in-laws: таст vs свекар)
 */
export function kinshipLabel(k: Kinship, bGender: Gender, aGender: Gender, locale: KinshipLocale = "sr"): string {
  const text = locale === "en" ? labelEn(k, bGender, aGender) : labelSr(k, bGender, aGender);
  return locale === "sr-Latn" ? cyrillicToLatin(text) : text;
}

function labelSr(k: Kinship, g: Gender, aGender: Gender): string {
  switch (k.kind) {
    case "self": return SR.self;
    case "none": return SR.none;
    case "parent": return pick(SR.parent[k.relation], g);
    case "child": return pick(SR.child[k.relation], g);
    case "spouse": return pick(k.former ? SR.exSpouse : SR.spouse, g);
    case "in_law":
      switch (k.key) {
        case "spouse_parent":
          return aGender === "male" ? pick(["таст", "ташта", "таст/ташта"], g)
            : aGender === "female" ? pick(["свекар", "свекрва", "свекар/свекрва"], g)
            : pick(["таст/свекар", "ташта/свекрва", "родитељ супружника"], g);
        case "child_spouse":
        case "sibling_spouse":
          return pick(["зет", "снаха", "зет/снаха"], g);
        case "spouse_sibling":
          return aGender === "male" ? pick(["шурак", "свастика", "шурак/свастика"], g)
            : aGender === "female" ? pick(["девер", "заова", "девер/заова"], g)
            : pick(["брат супружника", "сестра супружника", "брат/сестра супружника"], g);
        case "parent_spouse":
          return pick(["очух", "маћеха", "очух/маћеха"], g);
      }
      break;
    case "blood": {
      const { up, down } = k;
      if (down === 0) return SR.up[up] ? pick(SR.up[up]!, g) : SR.ancestor(up);
      if (up === 0) return SR.down[down] ? pick(SR.down[down]!, g) : SR.descendant(down);
      if (up === 1 && down === 1) return pick(k.half ? SR.halfSibling : SR.sibling, g);
      if (up === 2 && down === 1) {
        if (g === "female") return "тетка";
        return k.viaGender === "male" ? "стриц" : k.viaGender === "female" ? "ујак" : "стриц/ујак";
      }
      if (up === 1 && down === 2) {
        const bro = k.siblingGender === "male";
        const sis = k.siblingGender === "female";
        if (g === "female") return bro ? "синовица" : sis ? "сестричина" : "нећака";
        return bro ? "синовац" : sis ? "сестрић" : "нећак";
      }
      if (up === 2 && down === 2) {
        const via = k.siblingGender === "female" ? "тетке" : k.viaGender === "male" ? "стрица" : k.viaGender === "female" ? "ујака" : "стрица/ујака";
        return `${g === "female" ? "сестра" : "брат"} од ${via}`;
      }
      if (up === down) return SR.cousinN(up - 1, g);
      return pick(SR.relative, g);
    }
  }
  return SR.none;
}

function labelEn(k: Kinship, g: Gender, aGender: Gender): string {
  switch (k.kind) {
    case "self": return "me";
    case "none": return "no known relation";
    case "parent": return pick(EN.parent[k.relation], g);
    case "child": return pick(EN.child[k.relation], g);
    case "spouse": return pick(k.former ? EN.exSpouse : EN.spouse, g);
    case "in_law":
      switch (k.key) {
        case "spouse_parent": return pick(["father-in-law", "mother-in-law", "parent-in-law"], g);
        case "child_spouse": return pick(["son-in-law", "daughter-in-law", "child-in-law"], g);
        case "spouse_sibling":
        case "sibling_spouse": return pick(["brother-in-law", "sister-in-law", "sibling-in-law"], g);
        case "parent_spouse": return pick(["stepfather", "stepmother", "step-parent"], g);
      }
      break;
    case "blood": {
      const { up, down } = k;
      const greats = (n: number) => "great-".repeat(Math.max(0, n));
      if (down === 0) return up === 1 ? pick(EN.parent.biological, g) : `${greats(up - 2)}${pick(["grandfather", "grandmother", "grandparent"], g)}`;
      if (up === 0) return down === 1 ? pick(EN.child.biological, g) : `${greats(down - 2)}${pick(["grandson", "granddaughter", "grandchild"], g)}`;
      if (up === 1 && down === 1) return pick(k.half ? EN.halfSibling : EN.sibling, g);
      if (down === 1) return `${greats(up - 2)}${pick(EN.uncle, g)}`;
      if (up === 1) return `${greats(down - 2)}${pick(EN.nephew, g)}`;
      const degree = Math.min(up, down) - 1;
      const removed = Math.abs(up - down);
      const ord = ORD_EN[degree] ?? `${degree}th`;
      return `${ord} cousin${removed ? ` ${removed === 1 ? "once" : removed === 2 ? "twice" : `${removed} times`} removed` : ""}`;
    }
  }
  void aGender;
  return "no known relation";
}
