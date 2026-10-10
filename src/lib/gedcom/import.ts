// GEDCOM (.ged) -> backup JSON, so a file exported from Family Tree Maker (or Ancestry, MyHeritage,
// Gramps ...) can be imported as a new tree through the normal backup import.

import type { BackupFile } from "../backup/schema";
import type { DatePrecision, Gender } from "../types/db";

interface Line { level: number; tag: string; value: string; kids: Line[]; xref?: string }

/** Bytes -> text: BOM aware, UTF-8 first, Windows-1250 (Central European ANSI) as a fallback. */
export function decodeGedcom(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(b); } catch { return new TextDecoder("windows-1250").decode(b); }
}

function parseLines(text: string): Line[] {
  const roots: Line[] = [];
  const stack: Line[] = [];
  for (const raw of text.replace(/^﻿/, "").split(/\r\n|\r|\n/)) {
    const m = /^\s*(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s(.*))?$/.exec(raw);
    if (!m || !m[3]) continue;
    const level = Number(m[1]);
    const line: Line = { level, tag: m[3].toUpperCase(), value: m[4] ?? "", kids: [], xref: m[2] };
    if (line.tag === "CONC" || line.tag === "CONT") {
      const parent = stack[level - 1];
      if (parent) parent.value += (line.tag === "CONT" ? "\n" : "") + line.value;
      continue;
    }
    stack.length = level;
    stack[level] = line;
    if (level === 0) roots.push(line); else stack[level - 1]?.kids.push(line);
  }
  return roots;
}

const child = (l: Line, tag: string) => l.kids.find((k) => k.tag === tag);
const val = (l: Line | undefined, tag: string) => child(l ?? ({ kids: [] } as unknown as Line), tag)?.value.trim() || null;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** GEDCOM date phrase -> ISO date + precision ("ABT 1930", "BEF MAR 1930", "BET 1900 AND 1910" ...). */
export function parseGedcomDate(value: string | null): { date: string | null; precision: DatePrecision } {
  if (!value) return { date: null, precision: "exact" };
  let s = value.toUpperCase().replace(/^@#D[A-Z ]+@\s*/, "").trim();
  let precision: DatePrecision | null = null;
  const prefix = /^(ABT|ABOUT|CAL|EST|CIRCA|BEF|BEFORE|AFT|AFTER|FROM|BET|BETWEEN|TO)\.?\s+/.exec(s);
  if (prefix) {
    const p = prefix[1] ?? "";
    precision = p.startsWith("BEF") || p === "TO" ? "before" : p.startsWith("AFT") ? "after" : "about";
    s = s.slice(prefix[0].length).split(/\s+(?:AND|TO)\s+/)[0] ?? "";
  }
  const m = /^(?:(\d{1,2})\s+)?(?:([A-Z]{3})\s+)?(\d{3,4})$/.exec(s.trim());
  if (!m) return { date: null, precision: "exact" };
  const mi = m[2] ? MONTHS.indexOf(m[2]) : -1;
  if (m[2] && mi < 0) return { date: null, precision: "exact" };
  const y = (m[3] ?? "").padStart(4, "0");
  const mm = String(mi + 1).padStart(2, "0");
  const dd = String(m[1] ?? 1).padStart(2, "0");
  const iso = `${y}-${mi >= 0 ? mm : "01"}-${m[1] && mi >= 0 ? dd : "01"}`;
  const t = new Date(Date.UTC(2000, 0, 1)); t.setUTCFullYear(Number(y), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8)));
  if (t.getUTCFullYear() !== Number(y) || t.getUTCMonth() !== Number(iso.slice(5, 7)) - 1 || t.getUTCDate() !== Number(iso.slice(8))) return { date: null, precision: "exact" };
  return { date: iso, precision: precision ?? (m[1] && mi >= 0 ? "exact" : mi >= 0 ? "month" : "year") };
}

export interface GedcomResult { backup: BackupFile; people: number; families: number }

export function gedcomToBackup(text: string, treeName: string, newId: () => string = () => crypto.randomUUID()): GedcomResult | null {
  const recs = parseLines(text);
  const indis = recs.filter((r) => r.tag === "INDI" && r.xref);
  if (indis.length === 0) return null;
  const ids = new Map<string, string>();
  for (const r of indis) ids.set(r.xref!, newId());

  const persons: Record<string, unknown>[] = indis.map((r) => {
    const name = child(r, "NAME");
    let first = val(name, "GIVN"), last = val(name, "SURN");
    if (!first && !last && name) {
      const m = /^([^/]*)\/([^/]*)\/?(.*)$/.exec(name.value);
      first = (m ? m[1] ?? "" : name.value).trim() || null;
      last = m?.[2]?.trim() || null;
    }
    const sex = val(r, "SEX");
    const gender: Gender = sex === "M" ? "male" : sex === "F" ? "female" : sex ? "other" : "unknown";
    const birt = child(r, "BIRT"), deat = child(r, "DEAT");
    const bd = parseGedcomDate(val(birt, "DATE")), dd = parseGedcomDate(val(deat, "DATE"));
    const notes = r.kids.filter((k) => k.tag === "NOTE" && !k.value.startsWith("@")).map((k) => k.value.trim()).filter(Boolean).join("\n\n");
    return {
      id: ids.get(r.xref!), first_name: (first ?? "").trim() || "?", middle_name: null, last_name: last,
      birth_name: val(name, "_MARNM") ? last : null, nickname: val(name, "NICK"), gender,
      birth_date: bd.date, birth_date_precision: bd.precision, birth_place: val(birt, "PLAC"),
      is_living: !deat, death_date: dd.date, death_date_precision: dd.precision, death_place: val(deat, "PLAC"),
      occupation: val(r, "OCCU"), bio: null, notes: notes || null, avatar_media_id: null, extra: {},
    };
  });

  // How each child is attached to a family (adopted / foster), keyed by "childXref|famXref".
  const pedigree = new Map<string, "adoptive" | "foster" | "step">();
  for (const r of indis) for (const f of r.kids.filter((k) => k.tag === "FAMC")) {
    const pedi = (val(f, "PEDI") ?? "").toUpperCase();
    if (pedi === "ADOPTED") pedigree.set(`${r.xref}|${f.value}`, "adoptive");
    else if (pedi === "FOSTER") pedigree.set(`${r.xref}|${f.value}`, "foster");
  }

  const parent_child: Record<string, unknown>[] = [];
  const seenEdges = new Set<string>();
  const partnerships: Record<string, unknown>[] = [];
  const fams = recs.filter((r) => r.tag === "FAM" && r.xref);
  for (const f of fams) {
    const spouses = f.kids.filter((k) => k.tag === "HUSB" || k.tag === "WIFE").map((k) => ids.get(k.value.trim())).filter((x): x is string => !!x);
    for (const k of f.kids.filter((x) => x.tag === "CHIL")) {
      const c = ids.get(k.value.trim());
      if (!c) continue;
      for (const p of spouses) {
        if (p === c) continue;
        if (seenEdges.has(`${p}|${c}`)) continue; // the same link listed in two FAM records
        seenEdges.add(`${p}|${c}`);
        parent_child.push({ id: newId(), parent_id: p, child_id: c, relation: pedigree.get(`${k.value.trim()}|${f.xref}`) ?? "biological", start_date: null, notes: null });
      }
    }
    if (spouses.length === 2 && spouses[0] !== spouses[1]) {
      const marr = child(f, "MARR");
      const div = child(f, "DIV");
      partnerships.push({
        id: newId(), person1_id: spouses[0], person2_id: spouses[1], kind: marr || !child(f, "ENGA") ? "marriage" : "engagement",
        status: div ? "divorced" : "active", start_date: parseGedcomDate(val(marr, "DATE")).date, start_place: val(marr, "PLAC"),
        end_date: parseGedcomDate(val(div, "DATE")).date, sort_order: 0, notes: null,
      });
    }
  }

  return {
    people: persons.length, families: fams.length,
    backup: {
      format: "roots-branches", version: 1, exported_at: new Date().toISOString(),
      tree: { id: newId(), name: treeName, root_person_id: persons[0]?.id as string },
      persons, parent_child, partnerships, media: [],
    } as unknown as BackupFile,
  };
}
