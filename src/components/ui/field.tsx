import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

const base = "w-full rounded-xl border border-border bg-surface px-3 text-[15px] text-text placeholder:text-muted focus:border-primary focus:outline-none";

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, "h-11", className)} {...p} />;
}

export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, "min-h-24 py-2", className)} {...p} />;
}

export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(base, "h-11 appearance-auto", className)} {...p} />;
}

export function Field({ label, error, hint, children, className }: { label: string; error?: string | null; hint?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="text-sm font-medium text-muted">{label}</span>
      {children}
      {error ? <span className="text-sm text-danger" role="alert">{error}</span> : hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Switch({ checked, onChange, label, testId }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 py-2 text-left"
    >
      <span className="text-[15px]">{label}</span>
      <span className={cn("relative h-7 w-12 shrink-0 rounded-full transition", checked ? "bg-primary" : "bg-border")}>
        <span className={cn("absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all", checked ? "left-[22px]" : "left-0.5")} />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, testId }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; testId?: string }) {
  return (
    <div className="inline-flex rounded-xl bg-surface-2 p-1" role="tablist" data-testid={testId}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition", value === o.value ? "bg-surface text-text shadow-sm" : "text-muted")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
