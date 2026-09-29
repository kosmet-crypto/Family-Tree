"use client";
import { ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { lifespanLabel } from "@/lib/dates";
import type { FamilyGraph } from "@/lib/graph/family-graph";
import { kinship } from "@/lib/graph/kinship";
import { kinshipLabel } from "@/lib/graph/kinship-labels";
import { personDisplayName } from "@/lib/search";
import { initials } from "./person-node";

function generationTitle(g: number, hasRoot: boolean): string {
  if (!hasRoot) return `${g + 1}. генерација`;
  if (g === 0) return "Моја генерација";
  if (g === -1) return "Родитељи";
  if (g === -2) return "Бабе и деде";
  if (g < -2) return `Преци (${-g}. колено)`;
  if (g === 1) return "Деца";
  if (g === 2) return "Унуци";
  return `Потомци (${g}. колено)`;
}

/** Alternative view: everyone grouped by generation, with their relation to "me". */
export function GenerationList({ graph, rootId, onPick }: { graph: FamilyGraph; rootId: string | null; onPick: (id: string) => void }) {
  const groups = useMemo(() => graph.generationGroups(rootId), [graph, rootId]);
  const root = rootId ? graph.person(rootId) : undefined;
  return (
    <div className="h-full overflow-y-auto px-3 pb-28 pt-2" data-testid="generation-list">
      {groups.map((grp) => (
        <section key={grp.generation} className="mb-4">
          <h3 className="sticky top-0 z-10 bg-bg/95 px-1 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {generationTitle(grp.generation, !!root)} · {grp.persons.length}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {grp.persons.map((p) => {
              const rel = root && p.id !== root.id ? kinshipLabel(kinship(graph, root.id, p.id), p.gender, root.gender) : root && p.id === root.id ? "ја" : "";
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => onPick(p.id)} className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-2.5 text-left hover:bg-surface-2" data-testid="list-person">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-semibold text-muted">{initials(p)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{personDisplayName(p)}</span>
                      <span className="block truncate text-xs text-muted">
                        {[rel !== "нема познате везе" ? rel : "", lifespanLabel({ date: p.birth_date, precision: p.birth_date_precision }, { date: p.death_date, precision: p.death_date_precision }, p.is_living)].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <ChevronRight size={18} className="text-muted" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
