"use client";
import { DatabaseBackup, Download, FileArchive, History, RefreshCw, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { downloadJsonBackup, downloadZipBackup, importBackupFile } from "@/client/backup";
import { clientConfig } from "@/client/config";
import { useAuth } from "@/client/hooks/use-auth";
import { useRepo } from "@/client/hooks/use-repo";
import { errorText, type TreeSummary } from "@/client/repo";
import { apkVersionName, checkNow, refreshWebApp } from "@/client/update";
import { AppBar } from "@/components/app/app-bar";
import { BottomNav } from "@/components/app/bottom-nav";
import { UpdateNotice } from "@/components/app/update-notice";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

type Snapshot = { id: string; kind: string; label: string | null; person_count: number; created_at: string };

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border-2 border-border bg-surface p-4 shadow-candy">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-extrabold">{icon}{title}</h2>
      {children}
    </section>
  );
}

/** One place for everything about keeping data safe and the app current. */
export default function DataPage() {
  const auth = useAuth();
  const repo = useRepo();
  const router = useRouter();
  const toast = useToast();
  const [trees, setTrees] = useState<TreeSummary[]>([]);
  const [treeId, setTreeId] = useState("");
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [apk, setApk] = useState("");
  const [checking, setChecking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cloud = repo?.mode === "cloud";

  useEffect(() => { void apkVersionName().then(setApk); }, []);
  useEffect(() => {
    if (!repo || !auth.ready) return;
    void repo.listTrees().then((t) => { setTrees(t); setTreeId((cur) => cur || t[0]?.id || ""); }).catch(() => {});
  }, [repo, auth.ready]);

  const loadSnaps = async (id: string) => {
    if (!cloud || !id) return setSnaps([]);
    try {
      const { api } = await import("@/client/repo/cloud");
      setSnaps((await api<{ snapshots: Snapshot[] }>(`/api/trees/${id}/snapshots`)).snapshots);
    } catch { setSnaps([]); }
  };
  useEffect(() => { void loadSnaps(treeId); }, [treeId, cloud]); // eslint-disable-line react-hooks/exhaustive-deps

  const tree = trees.find((t) => t.id === treeId);
  const fail = (e: unknown) => toast(errorText(e), "error");

  const snapshotNow = async () => {
    try {
      const { api } = await import("@/client/repo/cloud");
      await api(`/api/trees/${treeId}/snapshots`, { method: "POST", body: JSON.stringify({ label: "Ручно" }) });
      toast("Снимак је направљен.");
      await loadSnaps(treeId);
    } catch (e) { fail(e); }
  };
  const restore = async (s: Snapshot) => {
    if (!confirm(`Вратити стабло на стање од ${new Date(s.created_at).toLocaleString("sr-RS")}? Тренутно стање се прво аутоматски чува као снимак.`)) return;
    try {
      const { api } = await import("@/client/repo/cloud");
      await api(`/api/trees/${treeId}/snapshots`, { method: "POST", body: JSON.stringify({ label: "Пре враћања" }) });
      await api(`/api/trees/${treeId}/snapshots/${s.id}/restore`, { method: "POST" });
      toast("Стабло је враћено.");
      router.push(`/tree?id=${treeId}`);
    } catch (e) { fail(e); }
  };
  const check = async () => {
    setChecking(true);
    try {
      const r = await checkNow();
      if (r.status === "new" && r.info) { toast(`Доступна је верзија ${r.info.version}.`); window.location.href = r.info.url; }
      else if (r.status === "current") toast("Имате најновију верзију апликације.");
      else if (r.status === "web") await refreshWebApp();
      else toast("Провера није успела. Покушајте поново са интернетом.", "error");
    } finally { setChecking(false); }
  };

  return (
    <div className="min-h-dvh pb-28">
      <AppBar title="Подаци и ажурирање" />
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4">
        <UpdateNotice />

        <Card title="Backup" icon={<DatabaseBackup size={20} className="text-primary" />}>
          {trees.length === 0 ? <p className="text-sm text-muted">Још нема стабала.</p> : (
            <div className="flex flex-col gap-3">
              <Select value={treeId} onChange={(e) => setTreeId(e.target.value)} aria-label="Стабло">
                {trees.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
              <div className="flex flex-wrap gap-2">
                <Button data-testid="export-json" onClick={() => repo && void downloadJsonBackup(repo, treeId).then(() => toast("Backup је сачуван.")).catch(fail)}>
                  <Download size={18} /> Сачувај backup{repo?.mode === "local" ? " (са сликама)" : ""}
                </Button>
                {cloud && tree && <Button variant="outline" onClick={() => void downloadZipBackup(treeId, tree.name).catch(fail)}><FileArchive size={18} /> ZIP са сликама</Button>}
              </div>
              <p className="text-xs text-muted">
                {cloud ? "Облак чува аутоматски снимак једном дневно за свако стабло које мењате." : "Подаци су само на овом уређају. Сачувајте backup повремено и пошаљите га себи (e-пошта, Drive)."}
              </p>
            </div>
          )}
        </Card>

        <Card title="Враћање и увоз" icon={<Upload size={20} className="text-primary" />}>
          <p className="mb-3 text-sm text-muted">Backup, ZIP или фајл из Family Tree Maker-а (GEDCOM) увози се као <b>ново стабло</b>, па се ништа постојеће не прегази.</p>
          <Button variant="outline" data-testid="settings-import" onClick={() => fileRef.current?.click()}><Upload size={18} /> Изабери фајл</Button>
          <input ref={fileRef} type="file" hidden data-testid="settings-import-input"
            onChange={(e) => { const f = e.target.files?.[0]; if (f && repo) void importBackupFile(repo, f).then((id) => router.push(`/tree?id=${id}`)).catch(fail); e.target.value = ""; }} />
        </Card>

        {cloud && treeId && (
          <Card title="Снимци у облаку" icon={<History size={20} className="text-primary" />}>
            <Button variant="outline" size="sm" onClick={() => void snapshotNow()}>Направи снимак сада</Button>
            <ul className="mt-3 flex flex-col gap-2">
              {snaps.length === 0 && <li className="text-sm text-muted">Још нема снимака.</li>}
              {snaps.slice(0, 12).map((s) => (
                <li key={s.id} className="flex items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <b className="block">{new Date(s.created_at).toLocaleString("sr-RS")}</b>
                    <span className="text-xs text-muted">{s.person_count} особа · {s.label ?? (s.kind === "auto" ? "аутоматски" : s.kind)}</span>
                  </span>
                  <Button size="sm" variant="outline" onClick={() => void restore(s)}>Врати</Button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="Ажурирање" icon={<RefreshCw size={20} className="text-primary" />}>
          <p className="mb-3 text-sm text-muted">
            {apk ? `Апликација ${apk} · веб ${clientConfig.appVersion}` : `Веб верзија ${clientConfig.appVersion}`}. Веб део се обнавља сам; нови APK је потребан само за ретке измене у самој апликацији.
          </p>
          <Button onClick={() => void check()} disabled={checking} data-testid="check-update"><RefreshCw size={18} className={checking ? "animate-spin" : ""} /> Провери ажурирање</Button>
        </Card>
      </main>
      <BottomNav />
    </div>
  );
}
