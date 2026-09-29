// Backup helpers shared by the home screen and settings.
import { backupFileName, parseBackup } from "@/lib/backup/schema";
import { RepoError, type Repo } from "./repo";

export async function importBackupFile(repo: Repo, file: File): Promise<string> {
  const isZip = file.name.endsWith(".zip") || file.type.includes("zip");
  if (isZip) {
    if (repo.mode !== "cloud") throw new RepoError("zip_needs_cloud", "ZIP backup се увози у cloud режиму; у локалном режиму користите JSON.");
    const { api } = await import("./repo/cloud");
    const res = await api<{ imported: { treeId: string } }>("/api/backups/import", { method: "POST", body: file, headers: { "content-type": "application/zip" } });
    return res.imported.treeId;
  }
  const parsed = parseBackup(await file.text());
  if (!parsed.ok) throw new RepoError(parsed.problem.code === "not_json" ? "invalid_json" : "bad_backup_format");
  return repo.importJson(parsed.data);
}

/** Saves a file: native share sheet in the app, download link in browsers. */
export async function saveFile(blob: Blob, name: string): Promise<void> {
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (isNativeApp() && nav.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: name });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadJsonBackup(repo: Repo, treeId: string): Promise<void> {
  const data = await repo.exportJson(treeId);
  await saveFile(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }), backupFileName(data.tree.name));
}

export async function downloadZipBackup(treeId: string, treeName: string): Promise<void> {
  const { api } = await import("./repo/cloud");
  const blob = await api<Blob>(`/api/trees/${treeId}/backup?format=zip`);
  await saveFile(blob, backupFileName(treeName).replace(/\.json$/, ".zip"));
}

export function isNativeApp(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
}
