"use client";
import { Settings, TreeDeciduous } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "../ui/cn";

const items = [
  { href: "/", label: "Стабла", icon: TreeDeciduous },
  { href: "/settings", label: "Подешавања", icon: Settings },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-md">
        {items.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link key={href} href={href} className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-xs", active ? "text-primary" : "text-muted")}>
              <Icon size={22} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
