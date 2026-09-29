"use client";
import { useEffect } from "react";
import { isNativeApp } from "@/client/backup";

/** Android back button: close an open sheet, go back, or leave the app from the home screen. */
export function NativeBridge() {
  useEffect(() => {
    if (!isNativeApp()) return;
    let remove: (() => void) | undefined;
    void import("@capacitor/app").then(({ App }) =>
      App.addListener("backButton", ({ canGoBack }) => {
        const dialog = document.querySelector("dialog[open]") as HTMLDialogElement | null;
        if (dialog) { dialog.close(); return; }
        if (canGoBack && window.location.pathname.replace(/\/$/, "") !== (process.env.NEXT_PUBLIC_BASE_PATH ?? "")) window.history.back();
        else void App.exitApp();
      }).then((h) => { remove = () => void h.remove(); }),
    );
    return () => remove?.();
  }, []);
  return null;
}
