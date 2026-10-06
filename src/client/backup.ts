// Backup helpers shared by the home screen and settings.
import { backupFileName, parseBackup } from "@/lib/backup/schema";
import { RepoError, type Repo } from "./repo";

/** GEDCOM text (a Family Tree Maker export) -> new tree. */
async function importGedcomText(repo: Repo, text: string, fileName: string): Promise<string> {
  const { gedcomToBackup } = await import("@/lib/gedcom/import");
  const name = fileName.replace(/\.[^.]+$/, "") || "Увезено стабло";
  const res = gedcomToBackup(text, name);
  if (!res) throw new RepoError("gedcom_empty", "У фајлу нема ниједне особе.");
  return repo.importJson(res.backup, name);
}

/** Imports a JSON backup, a ZIP backup or a Family Tree Maker file as a new tree.
 * The kind is detected from the content, not the name (Android pickers often hide the extension). */
export async function importBackupFile(repo: Repo, file: File): Promise<string> {
  const { decodeGedcom } = await import("@/lib/gedcom/import");
  const buf = await file.arrayBuffer();
  const b = new Uint8Array(buf);
  if (b[0] === 0x50 && b[1] === 0x4b) { // "PK": zip (our ZIP backup, or an .fbk/.ftmb)
    const { unzipSync } = await import("fflate");
    const names: string[] = [];
    const files = unzipSync(b, { filter: (f) => { names.push(f.name); return /\.ged$/i.test(f.name); } });
    const ged = Object.values(files)[0];
    if (ged) return importGedcomText(repo, decodeGedcom(ged.buffer.slice(ged.byteOffset, ged.byteOffset + ged.byteLength) as ArrayBuffer), file.name);
    if (names.some((n) => /\.json$/i.test(n))) {
      if (repo.mode !== "cloud") throw new RepoError("zip_needs_cloud", "ZIP backup се увози у cloud режиму; у локалном режиму користите JSON.");
      const { api } = await import("./repo/cloud");
      const res = await api<{ imported: { treeId: string } }>("/api/backups/import", { method: "POST", body: file, headers: { "content-type": "application/zip" } });
      return res.imported.treeId;
    }
    throw new RepoError("gedcom_not_found", `Овај фајл не садржи GEDCOM (унутра: ${names.slice(0, 8).join(", ")}). У Family Tree Maker-у изаберите Датотека > Извези > GEDCOM (.ged) и увезите тај фајл.`);
  }
  const text = decodeGedcom(buf);
  if (/^\s*0\s+HEAD\b/i.test(text.replace(/^\uFEFF/, "")) || /^\s*0\s+@[^@]+@\s+INDI\b/im.test(text)) return importGedcomText(repo, text, file.name);
  const parsed = parseBackup(text);
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
