"use client";
import { Camera, Heart, Pencil, Star, Trash2, UserPlus, Users, Baby } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatPartialDate } from "@/lib/dates";
import type { FamilyGraph } from "@/lib/graph/family-graph";
import { kinship } from "@/lib/graph/kinship";
import { kinshipLabel } from "@/lib/graph/kinship-labels";
import { personDisplayName } from "@/lib/search";
import type { Media, Person } from "@/lib/types/db";
import type { Repo } from "@/client/repo";
import { Button } from "../ui/button";
import { Sheet } from "../ui/sheet";
import type { RelationTarget } from "./person-dialog";
import { initials } from "./person-node";

const REL_SR: Record<string, string> = { biological: "", adoptive: " (усвојење)", step: " (step)", foster: " (хранитељ)", guardian: " (старатељ)" };
const STATUS_SR: Record<string, string> = { active: "", divorced: " · развод", separated: " · раздвојени", widowed: " · удовац/удовица", annulled: " · поништен" };

export function PersonPanel({
  person, graph, rootId, media, repo, canEdit, onClose, onEdit, onAdd, onMakeRoot, onDelete, onPhoto, onPick, onUnlinkParent, onUnlinkPartner, onEditPartner,
}: {
  person: Person | null; graph: FamilyGraph; rootId: string | null; media: Media[]; repo: Repo; canEdit: boolean;
  onClose: () => void; onEdit: (p: Person) => void; onAdd: (t: RelationTarget) => void; onMakeRoot: (p: Person) => void;
  onDelete: (p: Person) => void; onPhoto: (p: Person, file: File) => void; onPick: (id: string) => void;
  onUnlinkParent: (edgeId: string) => void; onUnlinkPartner: (partnershipId: string) => void; onEditPartner: (partnershipId: string) => void;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const photos = person ? media.filter((m) => m.person_id === person.id && m.kind === "photo") : [];

  useEffect(() => {
    let alive = true;
    void (async () => {
      const out: Record<string, string> = {};
      for (const m of photos) out[m.id] = await repo.mediaUrl(m);
      if (alive) setUrls(out);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person?.id, media, repo]);

  if (!person) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;

  const root = rootId ? graph.person(rootId) : undefined;
  const relation = root && root.id !== person.id ? kinshipLabel(kinship(graph, root.id, person.id), person.gender, root.gender) : null;
  const parents = graph.parents(person.id);
  const children = graph.children(person.id);
  const partners = graph.partners(person.id);
  const siblings = graph.siblings(person.id);
  const avatar = person.avatar_media_id ? urls[person.avatar_media_id] : photos[0] ? urls[photos[0].id] : undefined;
  const birth = formatPartialDate({ date: person.birth_date, precision: person.birth_date_precision });
  const death = formatPartialDate({ date: person.death_date, precision: person.death_date_precision });

  const Link = ({ p, suffix, onUnlink, onEdit }: { p: Person; suffix?: string; onUnlink?: () => void; onEdit?: () => void }) => (
    <li className="flex items-center gap-1">
      <button type="button" onClick={() => onPick(p.id)} className="flex-1 truncate rounded-lg px-2 py-1.5 text-left hover:bg-surface-2">
        {personDisplayName(p)}<span className="text-xs text-muted">{suffix}</span>
      </button>
      {canEdit && onEdit && <button type="button" aria-label="Измени везу" data-testid="edit-partnership" onClick={onEdit} className="rounded-lg p-1.5 text-muted hover:bg-surface-2"><Pencil size={14} /></button>}
      {canEdit && onUnlink && <button type="button" aria-label="Уклони везу" onClick={onUnlink} className="rounded-lg p-1.5 text-muted hover:bg-surface-2"><Trash2 size={14} /></button>}
    </li>
  );

  return (
    <Sheet open onClose={onClose} testId="person-panel" title={
      <span className="flex items-center gap-3">
        {avatar
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
          : <span className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-sm text-muted">{initials(person)}</span>}
        <span className="min-w-0">
          <span className="block truncate" data-testid="panel-name">{personDisplayName(person)}</span>
          {relation && <span className="block text-sm font-normal text-primary" data-testid="panel-relation">{relation}</span>}
          {root?.id === person.id && <span className="block text-sm font-normal text-primary">ја</span>}
        </span>
      </span>
    }>
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[15px]">
          {person.birth_name && <><dt className="text-muted">Рођено презиме</dt><dd>{person.birth_name}</dd></>}
          {person.nickname && <><dt className="text-muted">Надимак</dt><dd>{person.nickname}</dd></>}
          {birth && <><dt className="text-muted">Рођен/а</dt><dd>{birth}{person.birth_place ? `, ${person.birth_place}` : ""}</dd></>}
          {!person.is_living && <><dt className="text-muted">Преминуо/ла</dt><dd>{death || "да"}{person.death_place ? `, ${person.death_place}` : ""}</dd></>}
          {person.occupation && <><dt className="text-muted">Занимање</dt><dd>{person.occupation}</dd></>}
        </dl>
        {person.bio && <p className="whitespace-pre-wrap text-[15px]">{person.bio}</p>}
        {person.notes && <p className="whitespace-pre-wrap rounded-xl bg-surface-2 px-3 py-2 text-sm">{person.notes}</p>}

        <div className="grid gap-3 sm:grid-cols-2">
          {parents.length > 0 && <section><h4 className="mb-1 text-xs font-semibold uppercase text-muted">Родитељи</h4><ul>{parents.map((e) => <Link key={e.edge.id} p={e.person} suffix={REL_SR[e.relation]} onUnlink={() => onUnlinkParent(e.edge.id)} />)}</ul></section>}
          {partners.length > 0 && <section><h4 className="mb-1 text-xs font-semibold uppercase text-muted">Партнери</h4><ul>{partners.map((e) => <Link key={e.partnership.id} p={e.person} suffix={STATUS_SR[e.partnership.status]} onUnlink={() => onUnlinkPartner(e.partnership.id)} onEdit={() => onEditPartner(e.partnership.id)} />)}</ul></section>}
          {children.length > 0 && <section><h4 className="mb-1 text-xs font-semibold uppercase text-muted">Деца</h4><ul>{children.map((e) => <Link key={e.edge.id} p={e.person} suffix={REL_SR[e.relation]} onUnlink={() => onUnlinkParent(e.edge.id)} />)}</ul></section>}
          {siblings.length > 0 && <section><h4 className="mb-1 text-xs font-semibold uppercase text-muted">Браћа и сестре</h4><ul>{siblings.map((s) => <Link key={s.person.id} p={s.person} suffix={s.type === "full" ? "" : s.type === "half" ? " (полу)" : ` (${s.type === "adoptive" ? "усвојени" : "step"})`} />)}</ul></section>}
        </div>

        {photos.length > 0 && (
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase text-muted">Слике · {photos.length}</h4>
            <div className="grid grid-cols-3 gap-2" data-testid="photos">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {photos.map((m) => urls[m.id] && <img key={m.id} src={urls[m.id]} alt={m.caption ?? ""} className="aspect-square w-full rounded-xl object-cover" />)}
            </div>
          </section>
        )}

        {canEdit && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => onAdd({ kind: "parent", of: person })} data-testid="add-parent"><UserPlus size={18} /> Родитељ</Button>
              <Button variant="outline" onClick={() => onAdd({ kind: "partner", of: person })} data-testid="add-partner"><Heart size={18} /> Партнер</Button>
              <Button variant="outline" onClick={() => onAdd({ kind: "child", of: person })} data-testid="add-child"><Baby size={18} /> Дете</Button>
              <Button variant="outline" onClick={() => onAdd({ kind: "sibling", of: person })} data-testid="add-sibling"><Users size={18} /> Брат/сестра</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={() => onEdit(person)} data-testid="edit-person"><Pencil size={16} /> Измени</Button>
              <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} data-testid="add-photo"><Camera size={16} /> Слика</Button>
              {root?.id !== person.id && <Button variant="ghost" size="sm" onClick={() => onMakeRoot(person)} data-testid="make-root"><Star size={16} /> Ово сам ја</Button>}
              <Button variant="ghost" size="sm" className="text-danger" onClick={() => onDelete(person)} data-testid="delete-person"><Trash2 size={16} /> Обриши</Button>
              <input ref={fileRef} type="file" accept="image/*" hidden data-testid="photo-input"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(person, f); e.target.value = ""; }} />
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
