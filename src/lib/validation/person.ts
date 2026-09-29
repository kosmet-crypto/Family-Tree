// Person form validation for the Simple and Complex entry models.
// Limits mirror the CHECK constraints in supabase/migrations/…200_people.sql.

import { z } from "zod";
import { isDefinitelyBefore, isValidIsoDate, toDayRange } from "../dates";
import { DATE_PRECISIONS, GENDERS, type EntryMode, type Person } from "../types/db";
import { result, type Issue, type ValidationResult } from "./issues";

export const MAX_AGE_YEARS = 122;

/** Fields shown in the Simple model. */
export const SIMPLE_FIELDS = [
  "first_name", "last_name", "gender",
  "birth_date", "birth_date_precision", "birth_place",
  "is_living", "death_date", "death_date_precision",
  "avatar_media_id",
] as const;

/** Extra fields shown only in the Complex model. */
export const COMPLEX_FIELDS = [
  "middle_name", "birth_name", "nickname", "death_place", "occupation", "bio", "notes", "extra",
] as const;

const text = (max: number) =>
  z.string().trim().max(max).transform((s) => (s === "" ? null : s)).nullable().optional();

const isoDate = z
  .string()
  .refine(isValidIsoDate, { message: "invalid_date" })
  .nullable()
  .optional();

export const personInputSchema = z.object({
  first_name: z.string().trim().max(100).default(""),
  last_name: text(100),
  middle_name: text(100),
  birth_name: text(100),
  nickname: text(100),
  gender: z.enum(GENDERS as [string, ...string[]]).default("unknown"),
  birth_date: isoDate,
  birth_date_precision: z.enum(DATE_PRECISIONS as [string, ...string[]]).default("exact"),
  birth_place: text(200),
  is_living: z.boolean().default(true),
  death_date: isoDate,
  death_date_precision: z.enum(DATE_PRECISIONS as [string, ...string[]]).default("exact"),
  death_place: text(200),
  occupation: text(200),
  bio: text(20000),
  notes: text(20000),
  avatar_media_id: z.uuid().nullable().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export type PersonInput = z.input<typeof personInputSchema>;
export type PersonPayload = z.output<typeof personInputSchema>;

/**
 * Parses and checks a person form. In the Simple model the complex-only fields are dropped
 * from the payload so that saving never erases data entered earlier in the Complex model.
 */
export function validatePerson(
  input: PersonInput,
  mode: EntryMode,
  today: Date = new Date(),
): ValidationResult & { payload?: Partial<PersonPayload> } {
  const parsed = personInputSchema.safeParse(input);
  const issues: Issue[] = [];
  if (!parsed.success) {
    for (const e of parsed.error.issues) {
      const field = String(e.path[0] ?? "");
      issues.push({ code: field.endsWith("_date") ? "invalid_date" : "invalid_value", severity: "error", field });
    }
    return result(issues);
  }
  const p = parsed.data;

  if (!p.first_name && !(mode === "complex" && p.nickname)) {
    issues.push({ code: "name_required", severity: "error", field: "first_name" });
  }

  const todayIso = today.toISOString().slice(0, 10);
  const birth = { date: p.birth_date, precision: p.birth_date_precision as Person["birth_date_precision"] };
  const death = { date: p.death_date, precision: p.death_date_precision as Person["death_date_precision"] };

  for (const [field, pd] of [["birth_date", birth], ["death_date", death]] as const) {
    if (pd.date && isDefinitelyBefore({ date: todayIso }, pd)) {
      issues.push({ code: "date_in_future", severity: "error", field });
    }
  }

  if (p.is_living && (p.death_date || (mode === "complex" && p.death_place))) {
    issues.push({ code: "living_with_death_date", severity: "error", field: "death_date" });
  }

  if (p.birth_date && p.death_date && isDefinitelyBefore(death, birth)) {
    issues.push({ code: "death_before_birth", severity: "error", field: "death_date" });
  }

  // Living person born more than MAX_AGE_YEARS ago (or lifespan longer than that).
  const end = p.is_living ? { date: todayIso } : death;
  const rb = toDayRange(birth);
  const re = end.date ? toDayRange(end) : null;
  if (rb && re && Number.isFinite(rb.max) && Number.isFinite(re.min) && (re.min - rb.max) / 365.25 > MAX_AGE_YEARS) {
    issues.push({ code: "implausible_age", severity: "warning", field: "birth_date", params: { max: MAX_AGE_YEARS } });
  }

  const payload: Partial<PersonPayload> = { ...p };
  if (mode === "simple") {
    for (const f of COMPLEX_FIELDS) delete payload[f];
  }
  if (payload.extra === undefined) delete payload.extra;
  return { ...result(issues), payload };
}
