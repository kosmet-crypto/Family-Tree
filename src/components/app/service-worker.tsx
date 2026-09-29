"use client";
import { useEffect } from "react";

/** Registers the PWA service worker (not inside the native app, which bundles its files). */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    const native = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
    if (native) return;
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const v = encodeURIComponent(process.env.NEXT_PUBLIC_APP_VERSION ?? "dev");
    void navigator.serviceWorker.register(`${base}/sw.js?v=${v}`, { scope: `${base}/` }).catch(() => {});
  }, []);
  return null;
}
