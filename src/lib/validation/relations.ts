// Relationship checks before saving an edge. Errors match the database triggers
// (so the user sees them before the round-trip); warnings catch likely data-entry mistakes.

import { ageRange, isDefinitelyBefore, toDayRange, type PartialDate } from "../dates";
import type { FamilyGraph } from "../graph/family-graph";
import { kinship } from "../graph/kinship";
import { kinshipLabel } from "../graph/kinship-labels";
import type { ParentRelation, PartnershipKind, PartnershipStatus, Person, Uuid } from "../types/db";
import { result, type Issue, type ValidationResult } from "./issues";

export const MIN_PARENT_AGE = 12;
export const MAX_FATHER_AGE = 75;
export const MAX_MOTHER_AGE = 55;
export const MIN_PARTNER_AGE = 16;
/** A father can die up to ~10 months before the child is born. */
const POSTHUMOUS_FATHER_DAYS = 300;

export interface ParentChildInput {
  id?: Uuid;
  parent_id: Uuid;
  child_id: Uuid;
  relation: ParentRelation;
}

export interface PartnershipInput {
  id?: Uuid;
  person1_id: Uuid;
  person2_id: Uuid;
  kind: PartnershipKind;
  status: PartnershipStatus;
  start_date?: string | null;
  end_date?: string | null;
}

const birthOf = (p: Person): PartialDate => ({ date: p.birth_date, precision: p.birth_date_precision });
const deathOf = (p: Person): PartialDate => ({ date: p.death_date, precision: p.death_date_precision });

export function validateParentChild(graph: FamilyGraph, input: ParentChildInput): ValidationResult {
  const issues: Issue[] = [];
  const parent = graph.person(input.parent_id);
  const child = graph.person(input.child_id);

  if (input.parent_id === input.child_id) {
    return result([{ code: "self_relation", severity: "error" }]);
  }
  if (!parent || !child || parent.tree_id !== child.tree_id) {
    return result([{ code: "different_tree", severity: "error" }]);
  }

  const otherEdges = graph.parentEdgesOf(child.id).filter((e) => e.id !== input.id);
  if (otherEdges.some((e) => e.parent_id === parent.id)) {
    issues.push({ code: "duplicate_relation", severity: "error" });
  }
  if (graph.wouldCreateCycle(parent.id, child.id)) {
    issues.push({ code: "cycle", severity: "error" });
  }

  if (input.relation === "biological") {
    const bioParents = otherEdges.filter((e) => e.relation === "biological" && e.parent_id !== parent.id);
    if (bioParents.length >= 2) {
      issues.push({ code: "too_many_biological_parents", severity: "error" });
    }

    const pb = birthOf(parent);
    const cb = birthOf(child);
    const bothExact = pb.precision === "exact" && cb.precision === "exact";
    if (isDefinitelyBefore(cb, pb) || (bothExact && pb.date && cb.date && pb.date >= cb.date)) {
      issues.push({ code: "parent_younger_than_child", severity: "error" });
    } else {
      const age = ageRange(pb, cb);
      if (age && age[1] < MIN_PARENT_AGE && age[1] >= 0) {
        issues.push({ code: "parent_too_young", severity: "warning", params: { age: age[1] } });
      }
      const maxAge = parent.gender === "female" ? MAX_MOTHER_AGE : MAX_FATHER_AGE;
      if (age && age[0] > maxAge) {
        issues.push({ code: "parent_too_old", severity: "warning", params: { age: age[0] } });
      }
    }

    // Child born after the parent's death (fathers get ~10 months).
    const pd = toDayRange(deathOf(parent));
    const cbr = toDayRange(cb);
    if (!parent.is_living && pd && cbr && Number.isFinite(pd.max)) {
      const grace = parent.gender === "female" ? 0 : POSTHUMOUS_FATHER_DAYS;
      if (cbr.min > pd.max + grace) issues.push({ code: "born_after_parent_death", severity: "warning" });
    }

    const other = bioParents[0] && graph.person(bioParents[0].parent_id);
    if (other && bioParents.length === 1 && other.gender === parent.gender && (parent.gender === "male" || parent.gender === "female")) {
      issues.push({ code: "same_gender_biological_parents", severity: "warning" });
    }
  }

  return result(issues);
}

export function validatePartnership(graph: FamilyGraph, input: PartnershipInput): ValidationResult {
  const issues: Issue[] = [];
  const a = graph.person(input.person1_id);
  const b = graph.person(input.person2_id);

  if (input.person1_id === input.person2_id) {
    return result([{ code: "self_relation", severity: "error" }]);
  }
  if (!a || !b || a.tree_id !== b.tree_id) {
    return result([{ code: "different_tree", severity: "error" }]);
  }

  const start: PartialDate = { date: input.start_date ?? null };
  const end: PartialDate = { date: input.end_date ?? null };
  if (start.date && end.date && isDefinitelyBefore(end, start)) {
    issues.push({ code: "end_before_start", severity: "error", field: "end_date" });
  }

  const others = graph.partnershipsOf(a.id).filter((p) => p.id !== input.id);
  const samePair = others.filter((p) => p.person1_id === b.id || p.person2_id === b.id);
  if (input.status === "active" && samePair.some((p) => p.status === "active" && p.kind === input.kind)) {
    issues.push({ code: "duplicate_active_partnership", severity: "error" });
  }

  // Blood relatives: parent/child/sibling are errors, cousins etc. warnings.
  const k = kinship(graph, a.id, b.id);
  if (k.kind === "parent" || k.kind === "child" || k.kind === "blood") {
    const close =
      k.kind === "parent" ? k.relation === "biological"
      : k.kind === "child" ? k.relation === "biological"
      : k.up === 0 || k.down === 0 || (k.up === 1 && k.down === 1);
    const blood = k.kind === "blood" || close;
    if (blood) {
      issues.push({
        code: "partner_is_blood_relative",
        severity: close ? "error" : "warning",
        params: { relation: kinshipLabel(k, b.gender, a.gender, "sr") },
      });
    }
  }

  if (input.kind === "marriage" && input.status === "active") {
    for (const person of [a, b]) {
      const partner = person === a ? b : a;
      const clash = graph.partnershipsOf(person.id).some(
        (p) => p.id !== input.id && p.kind === "marriage" && p.status === "active"
          && p.person1_id !== partner.id && p.person2_id !== partner.id,
      );
      if (clash) {
        issues.push({ code: "overlapping_marriage", severity: "warning", params: { person: person.id } });
        break;
      }
    }
  }

  if (start.date) {
    for (const person of [a, b]) {
      const age = ageRange(birthOf(person), start);
      if (age && age[1] < MIN_PARTNER_AGE) {
        issues.push({ code: "partner_too_young", severity: "warning", params: { age: age[1] } });
        break;
      }
    }
    for (const person of [a, b]) {
      if (!person.is_living && person.death_date && isDefinitelyBefore(deathOf(person), start)) {
        issues.push({ code: "partnership_after_death", severity: "warning" });
        break;
      }
    }
  }

  return result(issues);
}
