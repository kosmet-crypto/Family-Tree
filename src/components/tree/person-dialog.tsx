"use client";
// Add / edit a person. Simple model: basic data. Complex model: middle/birth name, nickname,
// places, occupation, bio, notes, and the kind of relationship (biological, adoptive, step…;
// marriage status and dates for partners).

import { useEffect, useMemo, useState } from "react";
import type { FamilyGraph } from "@/lib/graph/family-graph";
import { personDisplayName, searchPersons } from "@/lib/search";
import type { DatePrecision, EntryMode, Gender, ParentRelation, PartnershipKind, PartnershipStatus, Person } from "@/lib/types/db";
import { issueMessage, type Issue } from "@/lib/validation/issues";
import { validatePerson, type PersonInput } from "@/lib/validation/person";
import { validateParentChild, validatePartnership } from "@/lib/validation/relations";
import { Button } from "../ui/button";
import { Field, Input, Segmented, Select, Switch, Textarea } from "../ui/field";
import { Sheet } from "../ui/sheet";

export type RelationTarget =
  | { kind: "parent"; of: Person }
  | { kind: "child"; of: Person }
  | { kind: "partner"; of: Person }
  | { kind: "sibling"; of: Person };

export interface PersonDialogResult {
  person: PersonInput & { id?: string };
  existingId?: string;
  relation?: {
    target: RelationTarget;
    parentRelation: ParentRelation;
    alsoWithPartnerId?: string | null;
    partnership?: { kind: PartnershipKind; status: PartnershipStatus; start_date: string | null; end_date: string | null };
  };
}

const TITLES: Record<RelationTarget["kind"], string> = {
  parent: "Додај родитеља",
  child: "Додај дете",
  partner: "Додај партнера",
  sibling: "Додај брата или сестру",
};

const PARENT_REL: { value: ParentRelation; label: string }[] = [
  { value: "biological", label: "Биолошки" },
  { value: "adoptive", label: "Усвојење" },
  { value: "step", label: "Очух / маћеха / пасторче" },
  { value: "foster", label: "Хранитељство" },
  { value: "guardian", label: "Старатељство" },
];

const PRECISION: { value: DatePrecision; label: string }[] = [
  { value: "exact", label: "тачан датум" },
  { value: "month", label: "месец и година" },
  { value: "year", label: "само година" },
  { value: "about", label: "око (приближно)" },
  { value: "before", label: "пре" },
  { value: "after", label: "после" },
];

type Form = {
  first_name: string; last_name: string; middle_name: string; birth_name: string; nickname: string;
  gender: Gender; birth_date: string; birth_date_precision: DatePrecision; birth_place: string;
  is_living: boolean; death_date: string; death_date_precision: DatePrecision; death_place: string;
  occupation: string; bio: string; notes: string;
};

const fromPerson = (p?: Person | null, lastName?: string | null): Form => ({
  first_name: p?.first_name ?? "", last_name: p?.last_name ?? lastName ?? "", middle_name: p?.middle_name ?? "",
  birth_name: p?.birth_name ?? "", nickname: p?.nickname ?? "", gender: p?.gender ?? "unknown",
  birth_date: p?.birth_date ?? "", birth_date_precision: p?.birth_date_precision ?? "exact", birth_place: p?.birth_place ?? "",
  is_living: p?.is_living ?? true, death_date: p?.death_date ?? "", death_date_precision: p?.death_date_precision ?? "exact",
  death_place: p?.death_place ?? "", occupation: p?.occupation ?? "", bio: p?.bio ?? "", notes: p?.notes ?? "",
});

export function PersonDialog({
  open, onClose, onSubmit, graph, treeId, editing, target, mode, onModeChange, busy,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (r: PersonDialogResult) => void | Promise<void>;
  graph: FamilyGraph;
  treeId: string;
  editing?: Person | null;
  target?: RelationTarget | null;
  mode: EntryMode;
  onModeChange: (m: EntryMode) => void;
  busy?: boolean;
}) {
  const [f, setF] = useState<Form>(fromPerson());
  const [source, setSource] = useState<"new" | "existing">("new");
  const [existingQuery, setExistingQuery] = useState("");
  const [existingId, setExistingId] = useState<string | null>(null);
  const [parentRelation, setParentRelation] = useState<ParentRelation>("biological");
  const [pKind, setPKind] = useState<PartnershipKind>("marriage");
  const [pStatus, setPStatus] = useState<PartnershipStatus>("active");
  const [pStart, setPStart] = useState("");
  const [pEnd, setPEnd] = useState("");
  const [withPartner, setWithPartner] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [confirmWarnings, setConfirmWarnings] = useState(false);

  const partnersOfTarget = useMemo(
    () => (target?.kind === "child" ? graph.partners(target.of.id).filter((p) => p.partnership.status === "active" || p.partnership.status === "widowed") : []),
    [graph, target],
  );

  useEffect(() => {
    if (!open) return;
    const inheritLast = target && (target.kind === "child" || target.kind === "sibling") ? target.of.last_name : null;
    setF(fromPerson(editing, inheritLast));
    setSource("new"); setExistingQuery(""); setExistingId(null);
    setParentRelation("biological"); setPKind("marriage"); setPStatus("active"); setPStart(""); setPEnd("");
    setWithPartner(partnersOfTarget.length === 1 ? partnersOfTarget[0]!.person.id : null);
    setIssues([]); setConfirmWarnings(false);
  }, [open, editing, target, partnersOfTarget]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((s) => ({ ...s, [k]: v })); setConfirmWarnings(false); };
  const complex = mode === "complex";
  const fieldIssue = (field: string) => issues.find((i) => i.field === field && i.severity === "error");

  const existingHits = useMemo(() => {
    const exclude = new Set(target ? [target.of.id] : []);
    const all = [...graph.persons.values()].filter((p) => !exclude.has(p.id));
    return (existingQuery ? searchPersons(all, existingQuery, 8).map((h) => h.person) : all.slice(0, 8));
  }, [graph, existingQuery, target]);

  const submit = async () => {
    const all: Issue[] = [];
    let personInput: PersonDialogResult["person"] | null = null;
    const newId = editing?.id ?? crypto.randomUUID();

    if (source === "new") {
      const input: PersonInput = {
        ...f,
        birth_date: f.birth_date || null, death_date: f.is_living ? null : f.death_date || null,
        death_place: f.is_living ? null : f.death_place,
      };
      const r = validatePerson(input, mode);
      all.push(...r.errors, ...r.warnings);
      if (r.ok && r.payload) personInput = { ...(r.payload as PersonInput), id: newId };
    } else if (!existingId) {
      all.push({ code: "name_required", severity: "error", field: "existing" });
    }

    // Relationship checks against the current graph (with the new person added virtually).
    if (target && (personInput || existingId)) {
      const otherId = existingId ?? newId;
      const virtual = personInput
        ? graph.person(otherId) ?? ({ ...personInput, id: otherId, tree_id: treeId, gender: personInput.gender ?? "unknown", birth_date_precision: personInput.birth_date_precision ?? "exact", death_date_precision: personInput.death_date_precision ?? "exact", is_living: personInput.is_living ?? true } as Person)
        : graph.person(otherId)!;
      const g = graph.person(otherId) ? graph : graph.withPerson(virtual);
      const check =
        target.kind === "parent" ? validateParentChild(g, { parent_id: otherId, child_id: target.of.id, relation: parentRelation })
        : target.kind === "child" ? validateParentChild(g, { parent_id: target.of.id, child_id: otherId, relation: parentRelation })
        : target.kind === "partner" ? validatePartnership(g, { person1_id: target.of.id, person2_id: otherId, kind: pKind, status: pStatus, start_date: pStart || null, end_date: pEnd || null })
        : null;
      if (check) all.push(...check.errors, ...check.warnings);
    }

    setIssues(all);
    const errors = all.filter((i) => i.severity === "error");
    const warnings = all.filter((i) => i.severity === "warning");
    if (errors.length) return;
    if (warnings.length && !confirmWarnings) { setConfirmWarnings(true); return; }

    await onSubmit({
      person: personInput ?? { id: existingId! },
      existingId: existingId ?? undefined,
      relation: target ? {
        target, parentRelation, alsoWithPartnerId: withPartner,
        partnership: target.kind === "partner" ? { kind: pKind, status: pStatus, start_date: pStart || null, end_date: pEnd || null } : undefined,
      } : undefined,
    });
  };

  const title = editing ? `Измени: ${personDisplayName(editing)}` : target ? `${TITLES[target.kind]} — ${personDisplayName(target.of)}` : "Нова особа";
  const errors = issues.filter((i) => i.severity === "error" && !i.field);
  const warnings = issues.filter((i) => i.severity === "warning");

  return (
    <Sheet open={open} onClose={onClose} title={title} testId="person-dialog" wide
      footer={<>
        <Button variant="outline" onClick={onClose}>Откажи</Button>
        <Button className="flex-1 justify-center" onClick={() => void submit()} disabled={busy} data-testid="save-person">
          {confirmWarnings ? "Ипак сачувај" : "Сачувај"}
        </Button>
      </>}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented<EntryMode> testId="mode-toggle" value={mode} onChange={onModeChange}
            options={[{ value: "simple", label: "Једноставан" }, { value: "complex", label: "Сложен" }]} />
          {target && !editing && target.kind !== "sibling" && (
            <Segmented<"new" | "existing"> value={source} onChange={setSource}
              options={[{ value: "new", label: "Нова особа" }, { value: "existing", label: "Постојећа" }]} />
          )}
        </div>

        {source === "existing" ? (
          <div className="flex flex-col gap-2">
            <Input placeholder="Претражи особе у стаблу" value={existingQuery} onChange={(e) => setExistingQuery(e.target.value)} />
            <ul className="flex flex-col gap-1">
              {existingHits.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setExistingId(p.id)}
                    className={`w-full rounded-xl px-3 py-2 text-left ${existingId === p.id ? "bg-primary text-primary-fg" : "hover:bg-surface-2"}`}>
                    {personDisplayName(p)} <span className="text-xs opacity-70">{p.birth_date?.slice(0, 4) ?? ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Име" error={fieldIssue("first_name") && issueMessage(fieldIssue("first_name")!)}>
                <Input value={f.first_name} onChange={(e) => set("first_name", e.target.value)} autoFocus data-testid="first-name" />
              </Field>
              <Field label="Презиме">
                <Input value={f.last_name} onChange={(e) => set("last_name", e.target.value)} data-testid="last-name" />
              </Field>
              {complex && <>
                <Field label="Средње име"><Input value={f.middle_name} onChange={(e) => set("middle_name", e.target.value)} /></Field>
                <Field label="Рођено презиме"><Input value={f.birth_name} onChange={(e) => set("birth_name", e.target.value)} data-testid="birth-name" /></Field>
                <Field label="Надимак" className="col-span-2"><Input value={f.nickname} onChange={(e) => set("nickname", e.target.value)} /></Field>
              </>}
            </div>
            <Field label="Пол">
              <Segmented<Gender> value={f.gender} onChange={(v) => set("gender", v)} testId="gender"
                options={[{ value: "male", label: "Мушко" }, { value: "female", label: "Женско" }, { value: "other", label: "Друго" }, { value: "unknown", label: "?" }]} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Датум рођења" error={fieldIssue("birth_date") && issueMessage(fieldIssue("birth_date")!)}>
                <Input type="date" value={f.birth_date} onChange={(e) => set("birth_date", e.target.value)} data-testid="birth-date" />
              </Field>
              <Field label="Тачност">
                <Select value={f.birth_date_precision} onChange={(e) => set("birth_date_precision", e.target.value as DatePrecision)}>
                  {PRECISION.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </Select>
              </Field>
              <Field label="Место рођења" className="col-span-2"><Input value={f.birth_place} onChange={(e) => set("birth_place", e.target.value)} /></Field>
            </div>
            <Switch checked={!f.is_living} onChange={(v) => set("is_living", !v)} label="Преминуо/ла" testId="deceased" />
            {!f.is_living && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Датум смрти" error={fieldIssue("death_date") && issueMessage(fieldIssue("death_date")!)}>
                  <Input type="date" value={f.death_date} onChange={(e) => set("death_date", e.target.value)} />
                </Field>
                <Field label="Тачност">
                  <Select value={f.death_date_precision} onChange={(e) => set("death_date_precision", e.target.value as DatePrecision)}>
                    {PRECISION.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </Select>
                </Field>
                {complex && <Field label="Место смрти" className="col-span-2"><Input value={f.death_place} onChange={(e) => set("death_place", e.target.value)} /></Field>}
              </div>
            )}
            {complex && <>
              <Field label="Занимање"><Input value={f.occupation} onChange={(e) => set("occupation", e.target.value)} /></Field>
              <Field label="Биографија"><Textarea value={f.bio} onChange={(e) => set("bio", e.target.value)} /></Field>
              <Field label="Белешке"><Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} data-testid="notes" /></Field>
            </>}
          </>
        )}

        {target && (target.kind === "parent" || target.kind === "child") && (complex || parentRelation !== "biological") && (
          <Field label="Врста везе">
            <Select value={parentRelation} onChange={(e) => setParentRelation(e.target.value as ParentRelation)} data-testid="parent-relation">
              {PARENT_REL.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </Field>
        )}
        {target?.kind === "child" && partnersOfTarget.length > 0 && source === "new" && (
          <Field label="Други родитељ">
            <Select value={withPartner ?? ""} onChange={(e) => setWithPartner(e.target.value || null)}>
              <option value="">— није у стаблу —</option>
              {partnersOfTarget.map((p) => <option key={p.person.id} value={p.person.id}>{personDisplayName(p.person)}</option>)}
            </Select>
          </Field>
        )}
        {target?.kind === "partner" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Веза">
              <Select value={pKind} onChange={(e) => setPKind(e.target.value as PartnershipKind)}>
                <option value="marriage">Брак</option><option value="civil_union">Грађанска заједница</option>
                <option value="partnership">Ванбрачна веза</option><option value="engagement">Веридба</option>
              </Select>
            </Field>
            <Field label="Статус">
              <Select value={pStatus} onChange={(e) => setPStatus(e.target.value as PartnershipStatus)} data-testid="partner-status">
                <option value="active">Траје</option><option value="divorced">Развод</option><option value="separated">Раздвојени</option>
                <option value="widowed">Удовац/удовица</option><option value="annulled">Поништен</option>
              </Select>
            </Field>
            {complex && <>
              <Field label="Почетак"><Input type="date" value={pStart} onChange={(e) => setPStart(e.target.value)} /></Field>
              <Field label="Крај"><Input type="date" value={pEnd} onChange={(e) => setPEnd(e.target.value)} /></Field>
            </>}
          </div>
        )}
        {target?.kind === "sibling" && (
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">
            Брат или сестра добија исте родитеље као {personDisplayName(target.of)}.
            {graph.parents(target.of.id).length === 0 && " Прво додајте бар једног родитеља."}
          </p>
        )}

        {(errors.length > 0 || warnings.length > 0) && (
          <ul className="flex flex-col gap-1 text-sm" data-testid="issues">
            {errors.map((i, n) => <li key={`e${n}`} className="rounded-lg bg-danger/10 px-3 py-2 text-danger">{issueMessage(i)}</li>)}
            {warnings.map((i, n) => <li key={`w${n}`} className="rounded-lg bg-accent/10 px-3 py-2 text-accent">⚠ {issueMessage(i)}</li>)}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
