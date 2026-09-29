"use client";
import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { lifespanLabel } from "@/lib/dates";
import { personDisplayName, searchPersons } from "@/lib/search";
import type { Person } from "@/lib/types/db";

/** Search at the top of the tree; picking a result flies the canvas to that person. */
export function SearchBox({ persons, onPick }: { persons: Person[]; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const hits = useMemo(() => searchPersons(persons, q, 8), [persons, q]);
  const pick = (id: string) => { onPick(id); setOpen(false); setQ(""); (document.activeElement as HTMLElement | null)?.blur(); };
  return (
    <div className="relative px-3 pb-2">
      <div className="flex h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3 shadow-sm focus-within:border-primary">
        <Search size={18} className="text-muted" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) pick(hits[0].person.id); if (e.key === "Escape") setOpen(false); }}
          placeholder="Пронађи особу…"
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
          data-testid="search"
          aria-label="Претрага"
        />
        {q && <button type="button" aria-label="Обриши" onClick={() => setQ("")}><X size={18} className="text-muted" /></button>}
      </div>
      {open && q && (
        <ul className="absolute inset-x-3 top-12 z-40 max-h-80 overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-xl" data-testid="search-results">
          {hits.length === 0 && <li className="px-4 py-3 text-sm text-muted">Нема резултата</li>}
          {hits.map(({ person }) => (
            <li key={person.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(person.id)} className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-surface-2">
                <span className="truncate">{personDisplayName(person)}</span>
                <span className="shrink-0 text-xs text-muted">{lifespanLabel({ date: person.birth_date, precision: person.birth_date_precision }, { date: person.death_date, precision: person.death_date_precision }, person.is_living)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
