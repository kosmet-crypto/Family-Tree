"use client";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { lifespanLabel } from "@/lib/dates";
import { personDisplayName } from "@/lib/search";
import type { Person } from "@/lib/types/db";
import { NODE_H, NODE_W } from "@/client/layout";
import { cn } from "../ui/cn";

export type PersonNodeData = { person: Person; avatarUrl?: string; isRoot: boolean; highlighted: boolean };
export type PersonFlowNode = Node<PersonNodeData, "person">;

const GENDER_COLOR: Record<Person["gender"], string> = {
  male: "var(--male)", female: "var(--female)", other: "var(--other)", unknown: "var(--edge)",
};

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
      style={{ width: NODE_W, height: NODE_H, borderLeftColor: GENDER_COLOR[p.gender] }}
      className={cn(
        "flex items-center gap-2.5 rounded-2xl border border-border border-l-[5px] bg-surface px-2.5 shadow-sm transition",
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
        <img src={data.avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" draggable={false} />
      ) : (
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-semibold text-muted">{initials(p)}</span>
      )}
      <span className="min-w-0 flex-1 leading-tight">
        <span className="line-clamp-2 text-[14px] font-semibold">{personDisplayName(p)}</span>
        <span className="block truncate text-xs text-muted">{years || " "}{!p.is_living && years && !years.startsWith("†") ? " †" : ""}</span>
        {data.isRoot && <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">ја</span>}
      </span>
    </div>
  );
}

export const PersonNode = memo(PersonNodeView);
