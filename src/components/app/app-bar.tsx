"use client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export function AppBar({ title, back, actions, children }: { title: ReactNode; back?: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="safe-top sticky top-0 z-30 rounded-b-3xl border-b-2 border-border bg-surface/95 shadow-candy backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-2">
        {back && (
          <Link href={back} aria-label="Назад" className="rounded-full p-2.5 hover:bg-surface-2"><ArrowLeft size={22} /></Link>
        )}
        <h1 className="min-w-0 flex-1 truncate px-2 text-lg font-extrabold">{title}</h1>
        {actions}
      </div>
      {children}
    </header>
  );
}
