// Validation results shared by the form (Simple/Complex modal) and the API routes.
// Errors block saving; warnings are shown but the user may confirm and save.

export type IssueCode =
  // person
  | "name_required"
  | "invalid_value"
  | "invalid_date"
  | "date_in_future"
  | "death_before_birth"
  | "living_with_death_date"
  | "implausible_age"
  // parent / child
  | "self_relation"
  | "cycle"
  | "duplicate_relation"
  | "too_many_biological_parents"
  | "parent_younger_than_child"
  | "parent_too_young"
  | "parent_too_old"
  | "born_after_parent_death"
  | "same_gender_biological_parents"
  | "different_tree"
  // partnership
  | "partner_is_blood_relative"
  | "partner_too_young"
  | "overlapping_marriage"
  | "duplicate_active_partnership"
  | "partnership_after_death"
  | "end_before_start";

export type Severity = "error" | "warning";

export interface Issue {
  code: IssueCode;
  severity: Severity;
  field?: string;
  params?: Record<string, string | number>;
}

export interface ValidationResult {
  ok: boolean; // no errors (warnings allowed)
  errors: Issue[];
  warnings: Issue[];
}

export function result(issues: Issue[]): ValidationResult {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  return { ok: errors.length === 0, errors, warnings };
}

/** Maps a database error (hint set by the SQL triggers) to an IssueCode. */
export function issueFromDbError(err: { hint?: string | null; code?: string | null; message?: string }): IssueCode | null {
  const byHint: Record<string, IssueCode> = {
    self_parent: "self_relation",
    cycle: "cycle",
    too_many_biological_parents: "too_many_biological_parents",
    parent_younger_than_child: "parent_younger_than_child",
  };
  if (err.hint && byHint[err.hint]) return byHint[err.hint]!;
  if (err.code === "23505" && err.message?.includes("parent_child_unique")) return "duplicate_relation";
  if (err.code === "23505" && err.message?.includes("partnerships_one_active_pair")) return "duplicate_active_partnership";
  if (err.code === "23514" && err.message?.includes("persons_death_after_birth")) return "death_before_birth";
  if (err.code === "23514" && err.message?.includes("persons_living_has_no_death")) return "living_with_death_date";
  return null;
}

const SR: Record<IssueCode, string> = {
  name_required: "Унесите име или надимак.",
  invalid_value: "Вредност није исправна.",
  invalid_date: "Датум није исправан.",
  date_in_future: "Датум је у будућности.",
  death_before_birth: "Датум смрти је пре датума рођења.",
  living_with_death_date: "Особа означена као жива не може имати датум или место смрти.",
  implausible_age: "Особа би имала више од {max} година.",
  self_relation: "Особа не може бити у вези сама са собом.",
  cycle: "Ова веза би особу учинила сопственим претком.",
  duplicate_relation: "Ова веза већ постоји.",
  too_many_biological_parents: "Особа може имати највише два биолошка родитеља.",
  parent_younger_than_child: "Биолошки родитељ мора бити рођен пре детета.",
  parent_too_young: "Родитељ би имао само {age} год. при рођењу детета.",
  parent_too_old: "Родитељ би имао {age} год. при рођењу детета.",
  born_after_parent_death: "Дете је рођено после смрти родитеља.",
  same_gender_biological_parents: "Оба биолошка родитеља су истог пола.",
  different_tree: "Особе припадају различитим стаблима.",
  partner_is_blood_relative: "Партнери су у крвном сродству ({relation}).",
  partner_too_young: "Партнер би имао само {age} год. на почетку везе.",
  overlapping_marriage: "Особа већ има активан брак у том периоду.",
  duplicate_active_partnership: "Ови партнери већ имају активну везу ове врсте.",
  partnership_after_death: "Веза почиње после смрти једног од партнера.",
  end_before_start: "Датум завршетка је пре датума почетка.",
};

const EN: Record<IssueCode, string> = {
  name_required: "Enter a first name or nickname.",
  invalid_value: "The value is not valid.",
  invalid_date: "The date is not valid.",
  date_in_future: "The date is in the future.",
  death_before_birth: "Death date is before birth date.",
  living_with_death_date: "A living person cannot have a death date or place.",
  implausible_age: "This person would be older than {max}.",
  self_relation: "A person cannot be related to themselves.",
  cycle: "This would make the person their own ancestor.",
  duplicate_relation: "This relationship already exists.",
  too_many_biological_parents: "A person can have at most two biological parents.",
  parent_younger_than_child: "A biological parent must be born before the child.",
  parent_too_young: "The parent would be only {age} at the child's birth.",
  parent_too_old: "The parent would be {age} at the child's birth.",
  born_after_parent_death: "The child was born after the parent's death.",
  same_gender_biological_parents: "Both biological parents have the same gender.",
  different_tree: "The people belong to different trees.",
  partner_is_blood_relative: "The partners are blood relatives ({relation}).",
  partner_too_young: "The partner would be only {age} when the relationship started.",
  overlapping_marriage: "This person already has an active marriage in that period.",
  duplicate_active_partnership: "These partners already have an active relationship of this kind.",
  partnership_after_death: "The relationship starts after one partner's death.",
  end_before_start: "End date is before start date.",
};

export function issueMessage(issue: Issue, locale: "sr" | "en" = "sr"): string {
  const template = (locale === "en" ? EN : SR)[issue.code];
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(issue.params?.[k] ?? ""));
}
