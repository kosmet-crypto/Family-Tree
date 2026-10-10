"use client";
// Edit an existing partnership in place: kind, status (e.g. divorced), dates and place.
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { FamilyGraph } from "@/lib/graph/family-graph";
import { personDisplayName } from "@/lib/search";
import type { Partnership, PartnershipKind, PartnershipStatus } from "@/lib/types/db";
import { issueMessage } from "@/lib/validation/issues";
import { validatePartnership } from "@/lib/validation/relations";
import { Button } from "../ui/button";
import { DateInput } from "../ui/date-input";
import { Field, Input, Segmented, Select } from "../ui/field";
import { Sheet } from "../ui/sheet";

const KINDS: { value: PartnershipKind; label: string }[] = [
  { value: "marriage", label: "Брак" }, { value: "civil_union", label: "Грађанска заједница" },
  { value: "partnership", label: "Партнерство" }, { value: "engagement", label: "Веридба" },
];
const STATUSES: { value: PartnershipStatus; label: string }[] = [
  { value: "active", label: "Траје" }, { value: "divorced", label: "Развод" }, { value: "separated", label: "Раздвојени" },
  { value: "widowed", label: "Удовац/удовица" }, { value: "annulled", label: "Поништен" },
];

export function PartnershipDialog({ partnership, graph, onClose, onSave, onDelete }: {
  partnership: Partnership | null; graph: FamilyGraph; onClose: () => void;
  onSave: (id: string, patch: Partial<Partnership>) => Promise<void>; onDelete: (p: Partnership) => void;
}) {
  const [kind, setKind] = useState<PartnershipKind>("marriage");
  const [status, setStatus] = useState<PartnershipStatus>("active");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [place, setPlace] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!partnership) return;
    setKind(partnership.kind); setStatus(partnership.status); setStart(partnership.start_date ?? "");
    setEnd(partnership.end_date ?? ""); setPlace(partnership.start_place ?? ""); setError(null);
  }, [partnership]);

  if (!partnership) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const a = graph.person(partnership.person1_id), b = graph.person(partnership.person2_id);
  const ended = status !== "active";

  const save = async () => {
    const v = validatePartnership(graph, { id: partnership.id, person1_id: partnership.person1_id, person2_id: partnership.person2_id, kind, status, start_date: start || null, end_date: ended ? end || null : null });
    const err = v.errors[0];
    if (err) return setError(issueMessage(err));
    setBusy(true);
    try {
      await onSave(partnership.id, { kind, status, start_date: start || null, end_date: ended ? end || null : null, start_place: place.trim() || null });
    } finally { setBusy(false); }
  };

  return (
    <Sheet open onClose={onClose} testId="partnership-dialog" title={<span className="text-base">{a && personDisplayName(a)} ♥ {b && personDisplayName(b)}</span>}
      footer={<div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="text-danger" onClick={() => onDelete(partnership)}><Trash2 size={16} /> Обриши везу</Button>
        <span className="flex-1" />
        <Button variant="outline" onClick={onClose}>Откажи</Button>
        <Button onClick={() => void save()} disabled={busy} data-testid="save-partnership">Сачувај</Button>
      </div>}>
      <div className="flex flex-col gap-3">
        <Field label="Врста"><Select value={kind} onChange={(e) => setKind(e.target.value as PartnershipKind)} data-testid="pe-kind">{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</Select></Field>
        <Field label="Стање">
          <Segmented<PartnershipStatus> testId="pe-status" value={status} onChange={setStatus} options={STATUSES} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Почетак"><DateInput value={start} onChange={setStart} /></Field>
          {ended && <Field label="Крај"><DateInput value={end} onChange={setEnd} /></Field>}
        </div>
        <Field label="Место венчања"><Input value={place} onChange={(e) => setPlace(e.target.value)} /></Field>
        {error && <p className="text-sm text-danger" role="alert" data-testid="pe-error">{error}</p>}
      </div>
    </Sheet>
  );
}
