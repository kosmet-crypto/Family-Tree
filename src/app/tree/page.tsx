"use client";
import { Download, Maximize2, Network, Share2, UserPlus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compressImage } from "@/lib/media/compress";
import { personDisplayName } from "@/lib/search";
import type { EntryMode, Partnership, Person } from "@/lib/types/db";
import { useAuth } from "@/client/hooks/use-auth";
import { useRepo } from "@/client/hooks/use-repo";
import { useTree } from "@/client/hooks/use-tree";
import { errorText } from "@/client/repo";
import { AppBar } from "@/components/app/app-bar";
import { TreeArt } from "@/components/app/tree-art";
import { ExportSheet } from "@/components/tree/export-sheet";
import { GenerationList } from "@/components/tree/generation-list";
import { PersonDialog, type PersonDialogResult, type RelationTarget } from "@/components/tree/person-dialog";
import { PartnershipDialog } from "@/components/tree/partnership-dialog";
import { PersonMiniCard } from "@/components/tree/person-mini-card";
import { familySides } from "@/client/layout";
import { kinship } from "@/lib/graph/kinship";
import { kinshipLabel } from "@/lib/graph/kinship-labels";
import { PersonPanel } from "@/components/tree/person-panel";
import { SearchBox } from "@/components/tree/search-box";
import { ShareSheet } from "@/components/tree/share-sheet";
import { TreeCanvas, type CanvasApi } from "@/components/tree/tree-canvas";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

function TreeScreen() {
  const params = useSearchParams();
  const treeId = params.get("id");
  const router = useRouter();
  const auth = useAuth();
  const repo = useRepo();
  const toast = useToast();
  const { data, graph, error, reload } = useTree(auth.ready ? repo : null, treeId);

  const [view, setView] = useState<"tree" | "list">("tree");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; editing?: Person | null; target?: RelationTarget | null }>({ open: false });
  const [mode, setMode] = useState<EntryMode>("simple");
  const [busy, setBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [editLink, setEditLink] = useState<Partnership | null>(null);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const canvas = useRef<CanvasApi | null>(null);
  const pendingFly = useRef<string | null>(null);

  useEffect(() => { if (repo && auth.ready) void repo.getEntryMode().then(setMode).catch(() => {}); }, [repo, auth.ready]);

  // Avatar URLs for the canvas
  useEffect(() => {
    if (!repo || !data) return;
    let alive = true;
    void (async () => {
      const out: Record<string, string> = {};
      for (const m of data.media) {
        if (data.persons.some((p) => p.avatar_media_id === m.id)) out[m.id] = await repo.mediaUrl(m);
      }
      if (alive) setAvatars(out);
    })();
    return () => { alive = false; };
  }, [repo, data]);

  // After a save, fly to the new person once the layout contains it.
  useEffect(() => {
    const id = pendingFly.current;
    if (id && graph?.person(id)) {
      pendingFly.current = null;
      setTimeout(() => canvas.current?.flyTo(id), 60);
    }
  }, [graph]);

  const rootId = data?.tree.root_person_id ?? null;
  const canEdit = data ? data.role !== "viewer" : false;
  const selected = selectedId && graph ? graph.person(selectedId) ?? null : null;
  const miniRelation = useMemo(() => {
    const root = rootId && graph ? graph.person(rootId) : undefined;
    if (!graph || !root || !selected) return null;
    return root.id === selected.id ? "ја" : kinshipLabel(kinship(graph, root.id, selected.id), selected.gender, root.gender);
  }, [graph, rootId, selected]);
  const persons = useMemo(() => (data ? data.persons : []), [data]);

  const pick = useCallback((id: string) => {
    setSelectedId(id);
    if (view === "list") { setView("tree"); pendingFly.current = id; setTimeout(() => { canvas.current?.flyTo(id); pendingFly.current = null; }, 120); }
    else canvas.current?.flyTo(id);
  }, [view]);

  const changeMode = (m: EntryMode) => { setMode(m); void repo?.setEntryMode(m).catch(() => {}); };

  const onSubmit = async (r: PersonDialogResult) => {
    if (!repo || !data || !graph) return;
    setBusy(true);
    let createdId: string | null = null;
    try {
      const treeIdv = data.tree.id;
      let personId = r.existingId ?? null;
      if (!personId) {
        const saved = await repo.savePerson({ ...(r.person as Partial<Person>), tree_id: treeIdv });
        personId = saved.id;
        if (!dialog.editing) createdId = saved.id;
      }
      const rel = r.relation;
      if (rel) {
        const of = rel.target.of.id;
        if (rel.target.kind === "parent") {
          await repo.addParentChild({ tree_id: treeIdv, parent_id: personId, child_id: of, relation: rel.parentRelation });
        } else if (rel.target.kind === "child") {
          await repo.addParentChild({ tree_id: treeIdv, parent_id: of, child_id: personId, relation: rel.parentRelation });
          if (rel.alsoWithPartnerId) await repo.addParentChild({ tree_id: treeIdv, parent_id: rel.alsoWithPartnerId, child_id: personId, relation: rel.parentRelation });
        } else if (rel.target.kind === "partner" && rel.partnership) {
          await repo.addPartnership({ tree_id: treeIdv, person1_id: of, person2_id: personId, ...rel.partnership });
        } else if (rel.target.kind === "sibling") {
          for (const e of graph.parentEdgesOf(of)) {
            await repo.addParentChild({ tree_id: treeIdv, parent_id: e.parent_id, child_id: personId, relation: e.relation });
          }
        }
      }
      setDialog({ open: false });
      await reload();
      setSelectedId(personId);
      pendingFly.current = personId;
      toast(dialog.editing ? "Сачувано." : "Особа је додата.");
    } catch (e) {
      // do not leave a half-linked new person behind
      if (createdId) await repo.deletePerson(data.tree.id, createdId).catch(() => {});
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const onPhoto = async (p: Person, file: File) => {
    if (!repo || !data) return;
    try {
      toast("Смањујем и шаљем слику…");
      const img = await compressImage(file);
      const m = await repo.uploadPhoto(data.tree.id, p.id, { blob: img.blob, width: img.width, height: img.height, mimeType: img.mimeType });
      if (!p.avatar_media_id) await repo.savePerson({ id: p.id, tree_id: data.tree.id, avatar_media_id: m.id });
      await reload();
      toast(`Слика је додата (${Math.round(img.blob.size / 1024)} KB).`);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  if (!treeId) return <p className="p-6">Недостаје стабло.</p>;
  if (error) return (
    <div className="p-6">
      <p className="mb-4 text-danger">{error}</p>
      <Button onClick={() => router.push("/")}>Назад на стабла</Button>
    </div>
  );

  return (
    <div className="flex h-dvh flex-col">
      <AppBar title={data?.tree.name ?? "…"} back="/"
        actions={<>
          {data && <Button variant="ghost" size="icon" aria-label="Извоз и backup" data-testid="open-export" onClick={() => setExportOpen(true)}><Download size={20} /></Button>}
          {repo?.mode === "cloud" && data && <Button variant="ghost" size="icon" aria-label="Подели" onClick={() => setShareOpen(true)} data-testid="share"><Share2 size={20} /></Button>}
        </>}>
        {data && data.persons.length > 0 && (
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1"><SearchBox persons={persons} onPick={pick} /></div>
            <div className="pr-3 pt-1">
              <Segmented<"tree" | "list"> testId="view-toggle" value={view} onChange={setView}
                options={[{ value: "tree", label: "Стабло" }, { value: "list", label: "Листа" }]} />
            </div>
          </div>
        )}
      </AppBar>

      <main className="relative min-h-0 flex-1">
        <TreeArt size={300} className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 opacity-[0.09]" />
        {!data || !graph ? (
          <p className="p-6 text-center text-muted">Учитавање…</p>
        ) : data.persons.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <Network size={56} className="text-primary" />
            <p className="text-lg font-medium">Стабло је празно</p>
            <p className="max-w-xs text-sm text-muted">Додајте прво себе. Затим из картице особе додајете родитеље, партнере, децу и браћу.</p>
            {canEdit && <Button onClick={() => setDialog({ open: true })} data-testid="add-first"><UserPlus size={18} /> Додај прву особу</Button>}
          </div>
        ) : view === "tree" ? (
          <>
            <TreeCanvas graph={graph} rootId={rootId} selectedId={selectedId} avatars={avatars}
              onSelect={(id) => { setSelectedId(id); setPanelOpen(false); }}
              onEditPartnership={(id) => { if (canEdit) setEditLink(data?.partnerships.find((p) => p.id === id) ?? null); }}
              onReady={(api) => { canvas.current = api; }} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 p-4 safe-bottom">
              {selected && (
                <PersonMiniCard person={selected} avatarUrl={selected.avatar_media_id ? avatars[selected.avatar_media_id] : undefined}
                  relation={miniRelation} gen={graph.generations(rootId).get(selected.id) ?? 0} side={familySides(graph, rootId).get(selected.id) ?? 0}
                  onMore={() => setPanelOpen(true)} onClose={() => setSelectedId(null)} />
              )}
              <Button variant="outline" className="pointer-events-auto shadow-md" onClick={() => canvas.current?.fit()} aria-label="Цело стабло"><Maximize2 size={18} /> Цело стабло</Button>
            </div>
          </>
        ) : (
          <GenerationList graph={graph} rootId={rootId} onPick={(id) => { setSelectedId(id); setPanelOpen(true); }} />
        )}
      </main>

      {data && graph && repo && (
        <>
          <PersonPanel
            person={panelOpen ? selected : null}
            graph={graph} rootId={rootId} media={data.media} repo={repo} canEdit={canEdit}
            onClose={() => setPanelOpen(false)}
            onPick={(id) => { setPanelOpen(false); pick(id); setTimeout(() => setPanelOpen(true), 850); }}
            onEdit={(p) => { setPanelOpen(false); setDialog({ open: true, editing: p }); }}
            onAdd={(t) => { setPanelOpen(false); setDialog({ open: true, target: t }); }}
            onMakeRoot={(p) => void repo.updateTree(data.tree.id, { root_person_id: p.id }).then(reload).then(() => toast("Стабло је сада приказано из угла ове особе."))}
            onDelete={(p) => {
              if (!confirm(`Обрисати особу „${personDisplayName(p)}“ и све њене везе?`)) return;
              setPanelOpen(false); setSelectedId(null);
              void repo.deletePerson(data.tree.id, p.id).then(reload).catch((e) => toast(errorText(e), "error"));
            }}
            onPhoto={(p, f) => void onPhoto(p, f)}
            onUnlinkParent={(id) => { if (confirm("Уклонити ову везу?")) void repo.deleteParentChild(data.tree.id, id).then(reload).catch((e) => toast(errorText(e), "error")); }}
            onEditPartner={(id) => { setPanelOpen(false); setEditLink(data.partnerships.find((p) => p.id === id) ?? null); }}
            onUnlinkPartner={(id) => { if (confirm("Уклонити ову везу?")) void repo.deletePartnership(data.tree.id, id).then(reload).catch((e) => toast(errorText(e), "error")); }}
          />
          <PartnershipDialog partnership={editLink} graph={graph} onClose={() => setEditLink(null)}
            onSave={async (id, patch) => { try { await repo.updatePartnership(data.tree.id, id, patch); setEditLink(null); await reload(); toast("Сачувано."); } catch (e) { toast(errorText(e), "error"); } }}
            onDelete={(p) => { if (!confirm("Обрисати ову везу? Особе остају у стаблу.")) return; setEditLink(null); void repo.deletePartnership(data.tree.id, p.id).then(reload).catch((e) => toast(errorText(e), "error")); }} />
          <ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} repo={repo} graph={graph} treeId={data.tree.id} treeName={data.tree.name} rootId={rootId} />
          <PersonDialog open={dialog.open} onClose={() => setDialog({ open: false })} onSubmit={onSubmit}
            graph={graph} treeId={data.tree.id} editing={dialog.editing} target={dialog.target}
            mode={mode} onModeChange={changeMode} busy={busy} />
          {repo.mode === "cloud" && (
            <ShareSheet open={shareOpen} onClose={() => setShareOpen(false)} treeId={data.tree.id} treeName={data.tree.name} role={data.role} userId={auth.user?.id ?? null} />
          )}
        </>
      )}
    </div>
  );
}

export default function TreePage() {
  return <Suspense fallback={<p className="p-6 text-center text-muted">Учитавање…</p>}><TreeScreen /></Suspense>;
}
