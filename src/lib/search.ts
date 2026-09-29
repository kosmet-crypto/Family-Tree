// Person search that treats Serbian Cyrillic, Latin with diacritics and plain ASCII as equal:
// "Петровић", "Petrović" and "petrovic" all match each other.

import type { Person } from "./types/db";

const CYR_TO_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "dj", е: "e", ж: "z", з: "z", и: "i", ј: "j",
  к: "k", л: "l", љ: "lj", м: "m", н: "n", њ: "nj", о: "o", п: "p", р: "r", с: "s", т: "t",
  ћ: "c", у: "u", ф: "f", х: "h", ц: "c", ч: "c", џ: "dz", ш: "s",
  // Macedonian / Russian / Bulgarian / Ukrainian letters
  ѓ: "gj", ќ: "kj", ѕ: "dz", й: "j", ё: "e", ы: "y", э: "e", ю: "ju", я: "ja", щ: "st", ъ: "", ь: "",
  є: "je", і: "i", ї: "ji", ґ: "g",
};

const LATIN_SPECIAL: Record<string, string> = { đ: "dj", ð: "d", ł: "l", ß: "ss", æ: "ae", ø: "o", œ: "oe" };

/** Lower-case ASCII search key: Cyrillic transliterated, diacritics removed, whitespace collapsed. */
export function searchKey(text: string | null | undefined): string {
  if (!text) return "";
  let out = "";
  for (const ch of text.toLowerCase()) {
    out += CYR_TO_LAT[ch] ?? LATIN_SPECIAL[ch] ?? ch;
  }
  return out
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Serbian Cyrillic -> Latin (for display in the other script), keeps diacritics and case. */
export function cyrillicToLatin(text: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "đ", е: "e", ж: "ž", з: "z", и: "i", ј: "j",
    к: "k", л: "l", љ: "lj", м: "m", н: "n", њ: "nj", о: "o", п: "p", р: "r", с: "s", т: "t",
    ћ: "ć", у: "u", ф: "f", х: "h", ц: "c", ч: "č", џ: "dž", ш: "š",
  };
  let out = "";
  for (const ch of text) {
    const lower = ch.toLowerCase();
    const lat = map[lower];
    if (lat === undefined) out += ch;
    else if (ch === lower) out += lat;
    else out += lat.charAt(0).toUpperCase() + lat.slice(1);
  }
  return out;
}

export function personDisplayName(p: Pick<Person, "first_name" | "middle_name" | "last_name" | "nickname">): string {
  const main = [p.first_name, p.middle_name, p.last_name].filter((s) => s && s.trim()).join(" ");
  if (main) return main;
  return p.nickname?.trim() || "?";
}

function personSearchText(p: Person): string {
  return searchKey([p.first_name, p.middle_name, p.last_name, p.birth_name, p.nickname, p.birth_place].join(" "));
}

export interface SearchHit {
  person: Person;
  score: number;
}

/**
 * Ranks people for the search box. Every query word must match the start of some word
 * (prefix) or, for words of 3+ letters, appear anywhere. Prefix matches rank higher.
 */
export function searchPersons(persons: readonly Person[], query: string, limit = 20): SearchHit[] {
  const words = searchKey(query).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const person of persons) {
    const text = personSearchText(person);
    const tokens = text.split(" ");
    let score = 0;
    let ok = true;
    for (const w of words) {
      if (tokens.some((t) => t === w)) score += 3;
      else if (tokens.some((t) => t.startsWith(w))) score += 2;
      else if (w.length >= 3 && text.includes(w)) score += 1;
      else { ok = false; break; }
    }
    if (ok) hits.push({ person, score });
  }
  hits.sort((a, b) => b.score - a.score || personDisplayName(a.person).localeCompare(personDisplayName(b.person)));
  return hits.slice(0, limit);
}
