// Partial / approximate genealogical dates.
// A date is stored as ISO "YYYY-MM-DD" plus a precision; e.g. "1930-01-01" + "year" means "1930".
// Comparisons work on the range of days a partial date can mean.

import type { DatePrecision, IsoDate } from "./types/db";

export interface PartialDate {
  date: IsoDate | null | undefined;
  precision?: DatePrecision | null;
}

/** Inclusive range in days since 1970-01-01 (UTC). Infinite ends for "before"/"after". */
export interface DayRange {
  min: number;
  max: number;
}

const DAY_MS = 86_400_000;
const ABOUT_YEARS = 2;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(value: string): { y: number; m: number; d: number } | null {
  const match = ISO_RE.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return { y, m, d };
}

export function isValidIsoDate(value: string): boolean {
  return parseIsoDate(value) !== null;
}

function dayNumber(y: number, m: number, d: number): number {
  // Date.UTC maps years 0..99 to 1900..1999; setUTCFullYear avoids that.
  const dt = new Date(Date.UTC(2000, m - 1, d));
  dt.setUTCFullYear(y);
  return Math.floor(dt.getTime() / DAY_MS);
}

function lastDayOfMonth(y: number, m: number): number {
  const dt = new Date(0);
  dt.setUTCFullYear(y, m, 0); // day 0 of the next month = last day of month m
  return dt.getUTCDate();
}

export function toDayRange(pd: PartialDate): DayRange | null {
  if (!pd.date) return null;
  const p = parseIsoDate(pd.date);
  if (!p) return null;
  const { y, m, d } = p;
  switch (pd.precision ?? "exact") {
    case "exact":
      return { min: dayNumber(y, m, d), max: dayNumber(y, m, d) };
    case "month":
      return { min: dayNumber(y, m, 1), max: dayNumber(y, m, lastDayOfMonth(y, m)) };
    case "year":
      return { min: dayNumber(y, 1, 1), max: dayNumber(y, 12, 31) };
    case "about":
      return { min: dayNumber(y - ABOUT_YEARS, 1, 1), max: dayNumber(y + ABOUT_YEARS, 12, 31) };
    case "before":
      return { min: -Infinity, max: dayNumber(y, m, d) };
    case "after":
      return { min: dayNumber(y, m, d), max: Infinity };
  }
}

/** true only when a is certainly earlier than b */
export function isDefinitelyBefore(a: PartialDate, b: PartialDate): boolean {
  const ra = toDayRange(a);
  const rb = toDayRange(b);
  return !!ra && !!rb && ra.max < rb.min;
}

/** true when a could be earlier than (or equal to) b */
export function isPossiblyBefore(a: PartialDate, b: PartialDate): boolean {
  const ra = toDayRange(a);
  const rb = toDayRange(b);
  if (!ra || !rb) return true;
  return ra.min <= rb.max;
}

/**
 * Age in whole years at a point in time, as [min, max] (equal when both dates are exact).
 * null when either date is missing.
 */
export function ageRange(birth: PartialDate, at: PartialDate | Date = new Date()): [number, number] | null {
  const rb = toDayRange(birth);
  const ra = at instanceof Date
    ? (() => { const n = Math.floor(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) / DAY_MS); return { min: n, max: n }; })()
    : toDayRange(at);
  if (!rb || !ra || !Number.isFinite(rb.min + rb.max + ra.min + ra.max)) return null;
  return [wholeYears(rb.max, ra.min), wholeYears(rb.min, ra.max)];
}

function wholeYears(fromDay: number, toDay: number): number {
  const a = new Date(fromDay * DAY_MS);
  const b = new Date(toDay * DAY_MS);
  let years = b.getUTCFullYear() - a.getUTCFullYear();
  if (b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())) {
    years -= 1;
  }
  return years;
}

export type DateLocale = "sr" | "sr-Latn" | "en";

const WORDS: Record<DateLocale, { about: string; before: string; after: string }> = {
  sr: { about: "око", before: "пре", after: "после" },
  "sr-Latn": { about: "oko", before: "pre", after: "posle" },
  en: { about: "about", before: "before", after: "after" },
};

/** "05.03.1930.", "03.1930.", "1930.", "око 1930." (sr) / "5 Mar 1930", "about 1930" (en) */
export function formatPartialDate(pd: PartialDate, locale: DateLocale = "sr"): string {
  if (!pd.date) return "";
  const p = parseIsoDate(pd.date);
  if (!p) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const en = locale === "en";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const full = en ? `${p.d} ${months[p.m - 1]} ${p.y}` : `${pad(p.d)}.${pad(p.m)}.${p.y}.`;
  const year = en ? `${p.y}` : `${p.y}.`;
  const w = WORDS[locale];
  switch (pd.precision ?? "exact") {
    case "exact":
      return full;
    case "month":
      return en ? `${months[p.m - 1]} ${p.y}` : `${pad(p.m)}.${p.y}.`;
    case "year":
      return year;
    case "about":
      return `${w.about} ${year}`;
    case "before":
      return `${w.before} ${year}`;
    case "after":
      return `${w.after} ${year}`;
  }
}

/** "1930 – 2001", "1990 –", "† 1944" style lifespan label for tree cards. */
export function lifespanLabel(
  birth: PartialDate,
  death: PartialDate,
  isLiving: boolean,
): string {
  const by = birth.date ? parseIsoDate(birth.date)?.y : undefined;
  const dy = death.date ? parseIsoDate(death.date)?.y : undefined;
  const approx = (pd: PartialDate) => (pd.precision && pd.precision !== "exact" && pd.precision !== "month" && pd.precision !== "year" ? "~" : "");
  const b = by !== undefined ? `${approx(birth)}${by}` : "";
  const d = dy !== undefined ? `${approx(death)}${dy}` : "";
  if (isLiving) return b ? `${b} –` : "";
  if (b && d) return `${b} – ${d}`;
  if (d) return `† ${d}`;
  return b ? `${b} – ?` : "";
}

// Typed date entry. The text shape follows the precision: DD.MM.YYYY, MM.YYYY or YYYY.
type InputShape = "day" | "month" | "year";
const shapeOf = (precision: DatePrecision | null | undefined): InputShape =>
  (precision ?? "exact") === "exact" ? "day" : precision === "month" ? "month" : "year";

export const DATE_INPUT_PLACEHOLDER: Record<InputShape, string> = { day: "ДД.ММ.ГГГГ", month: "ММ.ГГГГ", year: "ГГГГ" };
export const dateInputPlaceholder = (precision: DatePrecision | null | undefined) => DATE_INPUT_PLACEHOLDER[shapeOf(precision)];

/** Keeps digits only and inserts the dots while typing: "0503" -> "05.03", "05031930" -> "05.03.1930". */
export function maskDateInput(raw: string, precision: DatePrecision | null | undefined): string {
  const shape = shapeOf(precision);
  const digits = raw.replace(/\D/g, "").slice(0, shape === "day" ? 8 : shape === "month" ? 6 : 4);
  const cut = shape === "day" ? [2, 4] : shape === "month" ? [2] : [];
  let out = "";
  digits.split("").forEach((c, i) => { out += (cut.includes(i) ? "." : "") + c; });
  return out;
}

/** ISO date -> text for the input (parts the precision does not use are dropped). */
export function isoToDateInput(iso: string, precision: DatePrecision | null | undefined): string {
  const p = iso ? parseIsoDate(iso) : null;
  if (!p) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const shape = shapeOf(precision);
  return shape === "day" ? `${pad(p.d)}.${pad(p.m)}.${p.y}` : shape === "month" ? `${pad(p.m)}.${p.y}` : String(p.y).padStart(4, "0");
}

/** Complete, valid text -> ISO date ("" while incomplete or invalid). Month/year fill the rest with 01. */
export function dateInputToIso(text: string, precision: DatePrecision | null | undefined): string {
  const shape = shapeOf(precision);
  const m = (shape === "day" ? /^(\d{2})\.(\d{2})\.(\d{4})$/ : shape === "month" ? /^()(\d{2})\.(\d{4})$/ : /^()()(\d{4})$/).exec(text);
  if (!m) return "";
  const iso = `${m[3]}-${m[2] || "01"}-${m[1] || "01"}`;
  return parseIsoDate(iso) ? iso : "";
}
