import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

type Variant = "primary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg shadow-candy hover:brightness-110",
  outline: "border-2 border-border bg-surface text-text hover:bg-surface-2",
  ghost: "text-text hover:bg-surface-2",
  danger: "bg-danger text-white hover:brightness-110",
};
const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-[15px]",
  icon: "h-11 w-11 justify-center",
};

export function Button({ variant = "primary", size = "md", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={cn(
        "inline-flex items-center gap-2 rounded-full font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none",
        variants[variant], sizes[size], className,
      )}
      {...props}
    />
  );
}
