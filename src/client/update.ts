// "New APK available" check for the installed Android app (the web part updates itself over the
// air; a new APK is only needed for native changes). Reads the latest GitHub Release; any failure
// (offline, private repo, rate limit) simply means "no update shown".

import { isNativeApp } from "./backup";

const REPO = "kosmet-crypto/Family-Tree";

export interface UpdateInfo { version: string; url: string }

const build = (v: string) => Number(/^v?\d+\.\d+\.(\d+)/.exec(v)?.[1] ?? NaN);

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
