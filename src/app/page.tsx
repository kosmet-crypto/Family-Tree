"use client";
import { ChevronRight, Download, Plus, TreeDeciduous, Upload, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/client/hooks/use-auth";
import { useRepo } from "@/client/hooks/use-repo";
import { errorText, type TreeSummary } from "@/client/repo";
import { importBackupFile } from "@/client/backup";
import { AppBar } from "@/components/app/app-bar";
import { BottomNav } from "@/components/app/bottom-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";

export default function Home() {
  const auth = useAuth();
  const repo = useRepo();
  const router = useRouter();
  const toast = useToast();
  const [trees, setTrees] = useState<TreeSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!repo || !auth.ready) return;
    try { setTrees(await repo.listTrees()); } catch (e) { toast(errorText(e), "error"); setTrees([]); }
  }, [repo, auth.ready, toast]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!repo) return;
    try {
      const t = await repo.createTree(name || "Породично стабло");
      setCreating(false);
      setName("");
      router.push(`/tree?id=${t.id}`);
    } catch (e) { toast(errorText(e), "error"); }
  };

  const onImport = async (file: File | undefined) => {
    if (!repo || !file) return;
    try {
      const id = await importBackupFile(repo, file);
      toast("Backup је увезен као ново стабло.");
      router.push(`/tree?id=${id}`);
    } catch (e) { toast(errorText(e), "error"); }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="min-h-dvh pb-24">
      <AppBar title={<span className="flex items-center gap-2"><TreeDeciduous className="text-primary" size={22} /> Roots &amp; Branches</span>} />
      <main className="mx-auto max-w-2xl px-4 py-4">
        {repo?.mode === "local" && (
          <p className="mb-4 rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted" data-testid="local-mode">
            Локални режим: подаци се чувају само на овом уређају. Правите backup у Подешавањима.
          </p>
        )}
        <div className="mb-4 flex gap-2">
          <Button onClick={() => setCreating(true)} data-testid="new-tree"><Plus size={18} /> Ново стабло</Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload size={18} /> Увези backup</Button>
          <input ref={fileRef} type="file" accept=".json,.zip,.ged,.fbk,.ftmb,application/json,application/zip" hidden data-testid="import-file" onChange={(e) => void onImport(e.target.files?.[0])} />
        </div>

        {trees === null ? (
          <p className="py-12 text-center text-muted">Учитавање…</p>
        ) : trees.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <TreeDeciduous size={56} className="text-primary" />
            <p className="text-lg font-medium">Још немате ниједно стабло</p>
            <p className="max-w-xs text-sm text-muted">Почните са собом, па додајте родитеље, децу и партнере.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="tree-list">
            {trees.map((t) => (
              <li key={t.id}>
                <Link href={`/tree?id=${t.id}`} className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 hover:bg-surface-2">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-surface-2 text-primary"><TreeDeciduous size={22} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{t.name}</span>
                    <span className="flex items-center gap-2 text-xs text-muted">
                      {t.person_count !== undefined && <span>{t.person_count} особа</span>}
                      {t.role !== "owner" && <span className="flex items-center gap-1"><Users size={12} /> {t.role === "editor" ? "уредник" : "читалац"}</span>}
                      <span>{new Date(t.updated_at).toLocaleDateString("sr-RS")}</span>
                    </span>
                  </span>
                  <ChevronRight className="text-muted" size={20} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-8 flex items-center justify-center gap-1 text-xs text-muted"><Download size={12} /> Инсталирајте апликацију: „Додај на почетни екран“.</p>
      </main>

      <Sheet open={creating} onClose={() => setCreating(false)} title="Ново стабло"
        footer={<><Button variant="outline" onClick={() => setCreating(false)}>Откажи</Button><Button className="flex-1 justify-center" onClick={() => void create()} data-testid="create-tree">Направи</Button></>}>
        <Input autoFocus placeholder="нпр. Породица Петровић" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()} data-testid="tree-name" />
      </Sheet>
      <BottomNav />
    </div>
  );
}
