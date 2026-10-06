"use client";
import { FileArchive, FileDown, FileImage, FileText } from "lucide-react";
import { useState } from "react";
import { backupFileName } from "@/lib/backup/schema";
import type { FamilyGraph } from "@/lib/graph/family-graph";
import { downloadJsonBackup, saveFile } from "@/client/backup";
import { treeToPdf, treeToPng } from "@/client/export-tree";
import { errorText, type Repo } from "@/client/repo";
import { Button } from "../ui/button";
import { Sheet } from "../ui/sheet";
import { useToast } from "../ui/toast";

const slug = (s: string) => backupFileName(s).replace(/^porodicno-stablo-/, "").replace(/-\d{4}-\d{2}-\d{2}\.json$/, "") || "stablo";

/** Everything that leaves the app from the tree screen: print-ready PDF, picture, backup. */
export function ExportSheet({ open, onClose, repo, graph, treeId, treeName, rootId }: {
  open: boolean; onClose: () => void; repo: Repo; graph: FamilyGraph; treeId: string; treeName: string; rootId: string | null;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, job: () => Promise<void>) => {
    setBusy(key);
    try { await job(); toast("Сачувано."); } catch (e) { toast(errorText(e), "error"); } finally { setBusy(null); }
  };
  const day = new Date().toISOString().slice(0, 10);
  return (
    <Sheet open={open} onClose={onClose} title="Извоз и backup" testId="export-sheet">
      <div className="flex flex-col gap-3">
        <Button variant="outline" disabled={!!busy} data-testid="export-pdf" onClick={() => void run("pdf", async () => saveFile(await treeToPdf(graph, rootId, treeName, "A3"), `stablo-${slug(treeName)}-${day}.pdf`))}>
          <FileText size={18} /> {busy === "pdf" ? "Припрема…" : "PDF за штампу (A3)"}
        </Button>
        <Button variant="outline" disabled={!!busy} data-testid="export-png" onClick={() => void run("png", async () => saveFile(await treeToPng(graph, rootId, treeName), `stablo-${slug(treeName)}-${day}.png`))}>
          <FileImage size={18} /> {busy === "png" ? "Припрема…" : "Слика (PNG)"}
        </Button>
        <Button variant="outline" disabled={!!busy} data-testid="export-backup" onClick={() => void run("json", () => downloadJsonBackup(repo, treeId))}>
          <FileArchive size={18} /> Backup (JSON{repo.mode === "local" ? ", са сликама" : ""})
        </Button>
        <p className="flex items-start gap-2 text-xs text-muted"><FileDown size={14} className="mt-0.5 shrink-0" />Све се прави на вашем уређају, ништа се не шаље на интернет. Враћање из backup-а: екран „Подаци“.</p>
      </div>
    </Sheet>
  );
}
