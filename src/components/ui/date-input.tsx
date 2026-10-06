"use client";
import { useEffect, useState } from "react";
import { dateInputPlaceholder, dateInputToIso, isoToDateInput, maskDateInput } from "@/lib/dates";
import type { DatePrecision } from "@/lib/types/db";
import { Input } from "./field";

/** Typed date field (dots are added automatically); the text shape follows the precision. */
export function DateInput({ value, precision = "exact", onChange, testId }: {
  value: string; precision?: DatePrecision; onChange: (iso: string) => void; testId?: string;
}) {
  const [text, setText] = useState(() => isoToDateInput(value, precision));
  // Follow outside changes (precision switch, form reset) but keep half-typed text.
  useEffect(() => {
    setText((t) => (dateInputToIso(t, precision) === value ? t : isoToDateInput(value, precision)));
  }, [value, precision]);

  const bad = text.length >= dateInputPlaceholder(precision).length && !dateInputToIso(text, precision);
  return (
    <Input
      inputMode="numeric"
      autoComplete="off"
      value={text}
      placeholder={dateInputPlaceholder(precision)}
      aria-invalid={bad || undefined}
      data-testid={testId}
      className={bad ? "border-danger" : undefined}
      onChange={(e) => {
        const t = maskDateInput(e.target.value, precision);
        setText(t);
        const iso = dateInputToIso(t, precision);
        onChange(iso);
      }}
    />
  );
}
