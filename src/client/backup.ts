// Backup helpers shared by the home screen and settings.
import { backupFileName, parseBackup } from "@/lib/backup/schema";
import { RepoError, type Repo } from "./repo";

/** Family Tree Maker (.ged export, or a zip that contains one) -> new tree. */
export async function importGedcomFile(repo: Repo, file: File): Promise<string> {
  const { decodeGedcom, gedcomToBackup } = await import("@/lib/gedcom/import");
  let buf = await file.arrayBuffer();
  const head = new Uint8Array(buf, 0, 2);
  if (head[0] === 0x50 && head[1] === 0x4b) { // "PK": .fbk / .ftmb / .zip
    const { unzipSync } = await import("fflate");
    const files = unzipSync(new Uint8Array(buf), { filter: (f) => /\.ged$/i.test(f.name) });
    const ged = Object.values(files)[0];
    if (!ged) throw new RepoError("gedcom_not_found", "У овом фајлу нема GEDCOM-а. У Family Tree Maker-у изаберите Датотека > Извези > GEDCOM (.ged) и увезите тај фајл.");
    buf = ged.buffer.slice(ged.byteOffset, ged.byteOffset + ged.byteLength) as ArrayBuffer;
  }
  const name = file.name.replace(/\.[^.]+$/, "") || "Увезено стабло";
  const res = gedcomToBackup(decodeGedcom(buf), name);
  if (!res) throw new RepoError("gedcom_empty", "У фајлу нема ниједне особе.");
  return repo.importJson(res.backup, name);
}

export async function importBackupFile(repo: Repo, file: File): Promise<string> {
  if (/\.(ged|fbk|ftmb)$/i.test(file.name)) return importGedcomFile(repo, file);
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
