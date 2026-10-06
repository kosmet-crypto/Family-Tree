"use client";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { lifespanLabel } from "@/lib/dates";
import { personDisplayName } from "@/lib/search";
import type { Person } from "@/lib/types/db";
import { NODE_H, NODE_W, type Side } from "@/client/layout";
import { cn } from "../ui/cn";

export type PersonNodeData = { person: Person; avatarUrl?: string; isRoot: boolean; highlighted: boolean; gen: number; side?: Side };
export type PersonFlowNode = Node<PersonNodeData, "person">;

const GENDER_COLOR: Record<Person["gender"], string> = {
  male: "var(--male)", female: "var(--female)", other: "var(--other)", unknown: "var(--edge)",
};

/** Pastel fill and border of a generation (6 colours, cycled), tinted warm for the father's side and cool for the mother's. */
export const SIDE_TINT = { "-1": "#ff9f43", "1": "#3ea0ff" } as const;
export function genColors(gen: number, side: Side = 0) {
  const i = ((gen % 6) + 6) % 6;
  const mix = (c: string, pct: number) => (side === 0 ? c : `color-mix(in oklab, ${c}, ${SIDE_TINT[String(side) as "-1" | "1"]} ${pct}%)`);
  return { fill: mix(`var(--gen-${i})`, 38), border: mix(`var(--gen-${i}b, var(--gen-${i}))`, 55) };
}

export const initials = (p: Person) =>
  ((p.first_name?.[0] ?? "") + (p.last_name?.[0] ?? "")).toUpperCase() || "?";

function PersonNodeView({ data, selected }: NodeProps<PersonFlowNode>) {
  const p = data.person;
  const years = lifespanLabel(
    { date: p.birth_date, precision: p.birth_date_precision },
    { date: p.death_date, precision: p.death_date_precision },
    p.is_living,
  );
  return (
    <div
      data-testid="person-node"
      data-person-id={p.id}
      style={{ width: NODE_W, height: NODE_H, background: genColors(data.gen, data.side).fill, borderColor: genColors(data.gen, data.side).border }}
      className={cn(
        "relative flex items-center gap-2.5 rounded-[28px] border-2 px-2.5 shadow-candy transition",
        (selected || data.highlighted) && "ring-4 ring-primary/40",
        !p.is_living && "opacity-90",
      )}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
      <Handle id="l" type="target" position={Position.Left} className="!opacity-0" />
      <Handle id="r" type="source" position={Position.Right} className="!opacity-0" />
      {data.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.avatarUrl} alt="" style={{ borderColor: GENDER_COLOR[p.gender] }} className="h-12 w-12 shrink-0 rounded-full border-[3px] object-cover" draggable={false} />
      ) : (
        <span style={{ borderColor: GENDER_COLOR[p.gender] }} className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-[3px] bg-surface text-sm font-bold text-muted">{initials(p)}</span>
      )}
      <span className="min-w-0 flex-1 leading-tight">
        <span className="line-clamp-2 text-[14px] font-bold">{personDisplayName(p)}</span>
        <span className="block truncate text-xs text-muted">{years || " "}{!p.is_living && years && !years.startsWith("†") ? " †" : ""}</span>
        {data.isRoot && <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">ја</span>}
      </span>
    </div>
  );
}

export const PersonNode = memo(PersonNodeView);
