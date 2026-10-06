// "New APK available" check for the installed Android app (the web part updates itself over the
// air; a new APK is only needed for native changes). Reads the latest GitHub Release; any failure
// (offline, private repo, rate limit) simply means "no update shown".

import { isNativeApp } from "./backup";

const REPO = "kosmet-crypto/Family-Tree";

export interface UpdateInfo { version: string; url: string }

const build = (v: string) => Number(/^v?\d+\.\d+\.(\d+)/.exec(v)?.[1] ?? NaN);

/** Version of the installed APK ("" in a browser); the web part has its own number. */
export async function apkVersionName(): Promise<string> {
  if (!isNativeApp()) return "";
  try { return (await (await import("@capacitor/app")).App.getInfo()).version; } catch { return ""; }
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isNativeApp()) return null;
  try {
    const { App } = await import("@capacitor/app");
    const current = build((await App.getInfo()).version);
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json" } });
    if (!res.ok) return null;
    const rel = (await res.json()) as { tag_name?: string; html_url?: string; assets?: { name: string; browser_download_url: string }[] };
    const latest = build(rel.tag_name ?? "");
    if (!Number.isFinite(current) || !Number.isFinite(latest) || latest <= current) return null;
    const apk = rel.assets?.find((a) => a.name.endsWith(".apk"));
    return { version: (rel.tag_name ?? "").replace(/^v/, ""), url: apk?.browser_download_url ?? rel.html_url ?? `https://github.com/${REPO}/releases/latest` };
  } catch {
    return null;
  }
}

export type UpdateStatus = "new" | "current" | "web" | "error";

/** Explicit check from the Data screen. In a browser there is no APK; the web part is refreshed instead. */
export async function checkNow(): Promise<{ status: UpdateStatus; info?: UpdateInfo }> {
  if (!isNativeApp()) return { status: "web" };
  const info = await checkForUpdate();
  if (info) return { status: "new", info };
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
    return { status: res.ok ? "current" : "error" };
  } catch {
    return { status: "error" };
  }
}

/** Drops the offline copies and reloads, so the newest web version is fetched (no reinstall needed). */
export async function refreshWebApp(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations();
    await Promise.all((regs ?? []).map((r) => r.unregister()));
    const keys = await caches?.keys();
    await Promise.all((keys ?? []).filter((k) => k.startsWith("rb-")).map((k) => caches.delete(k)));
  } catch { /* nothing cached */ }
  location.reload();
}
