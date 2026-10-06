"use client";
import { ChevronRight, X } from "lucide-react";
import { formatPartialDate } from "@/lib/dates";
import { personDisplayName } from "@/lib/search";
import type { Person } from "@/lib/types/db";
import type { Side } from "@/client/layout";
import { genColors, initials } from "./person-node";

/** Small profile shown when a person is tapped in the tree: name, birth date and place. */
export function PersonMiniCard({ person, avatarUrl, relation, gen, side, onMore, onClose }: {
  person: Person; avatarUrl?: string; relation?: string | null; gen: number; side?: Side; onMore: () => void; onClose: () => void;
}) {
  const birth = formatPartialDate({ date: person.birth_date, precision: person.birth_date_precision });
  const death = person.is_living ? "" : formatPartialDate({ date: person.death_date, precision: person.death_date_precision });
  const c = genColors(gen, side);
  return (
    <div data-testid="mini-card" style={{ background: c.fill, borderColor: c.border }}
      className="pointer-events-auto relative mx-auto flex w-full max-w-sm items-center gap-3 rounded-[28px] border-2 p-3 pr-4 shadow-candy">
      {avatarUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={avatarUrl} alt="" className="h-16 w-16 shrink-0 rounded-full border-[3px] border-surface object-cover" />
        : <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full border-[3px] border-surface bg-surface text-lg font-bold text-muted">{initials(person)}</span>}
      <div className="min-w-0 flex-1 leading-snug">
        <p className="truncate text-base font-extrabold" data-testid="mini-name">{personDisplayName(person)}</p>
        {relation && <p className="text-xs font-semibold text-primary">{relation}</p>}
        <p className="truncate text-sm text-muted" data-testid="mini-birth">
          {birth ? `Рођен/а ${birth}` : "Датум рођења није унет"}{person.birth_place ? ` · ${person.birth_place}` : ""}
        </p>
        {death && <p className="truncate text-sm text-muted">† {death}</p>}
      </div>
      <button type="button" onClick={onMore} data-testid="open-panel" aria-label="Детаљи"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-fg shadow-candy"><ChevronRight size={22} /></button>
      <button type="button" onClick={onClose} aria-label="Затвори" className="absolute -right-1 -top-1 grid h-7 w-7 place-items-center rounded-full bg-surface text-muted shadow"><X size={14} /></button>
    </div>
  );
}
