"use client";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { checkForUpdate, type UpdateInfo } from "@/client/update";

/** Shows a banner when a newer APK exists (native app only); nothing otherwise. */
export function UpdateNotice() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  useEffect(() => { void checkForUpdate().then(setInfo); }, []);
  if (!info) return null;
  return (
    <a href={info.url} data-testid="update-notice"
      className="mb-4 flex items-center gap-3 rounded-3xl border-2 border-primary bg-surface-2 px-4 py-3 shadow-candy">
      <Download size={22} className="shrink-0 text-primary" />
      <span className="flex-1 text-sm"><b className="block text-[15px]">Нова верзија {info.version}</b>Додирните да преузмете и инсталирате. Подаци остају сачувани.</span>
    </a>
  );
}
