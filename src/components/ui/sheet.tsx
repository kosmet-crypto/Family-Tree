"use client";
// Modal that is a bottom sheet on phones and a centred dialog on larger screens (native <dialog>).
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "./cn";

export function Sheet({ open, onClose, title, children, footer, testId, wide }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; testId?: string; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      data-testid={testId}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={cn(
        "m-0 mt-auto w-full max-w-none rounded-t-3xl bg-surface p-0 text-text shadow-2xl sm:m-auto sm:rounded-3xl",
        wide ? "sm:max-w-2xl" : "sm:max-w-lg",
        "max-h-[92dvh]",
      )}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button type="button" aria-label="Затвори" onClick={onClose} className="rounded-full p-2 hover:bg-surface-2"><X size={20} /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="safe-bottom flex gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
