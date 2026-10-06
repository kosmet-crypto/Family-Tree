"use client";
import { DatabaseBackup, Settings, TreeDeciduous } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "../ui/cn";

const items = [
  { href: "/", label: "Стабла", icon: TreeDeciduous },
  { href: "/data", label: "Подаци", icon: DatabaseBackup },
  { href: "/settings", label: "Подешавања", icon: Settings },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 px-3 pt-2">
      <div className="mx-auto flex max-w-md gap-1 rounded-full border-2 border-border bg-surface/95 p-1.5 shadow-candy backdrop-blur">
        {items.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link key={href} href={href} className={cn("flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-xs font-semibold transition", active ? "bg-primary text-primary-fg" : "text-muted")}>
              <Icon size={22} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
