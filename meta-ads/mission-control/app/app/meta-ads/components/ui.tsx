"use client";

// Small shared building blocks for the Meta Ads dashboard, styled with the
// Mission Control tokens. Body type never goes below 14px and every control is
// at least 36px tall.

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cm-purple focus-visible:ring-offset-2 focus-visible:ring-offset-dark-bg";

type Variant = "primary" | "secondary" | "ghost";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-cm-purple text-white shadow-sm hover:bg-[color:var(--color-purple2)]",
  secondary: "border border-[color:var(--color-border-strong)] bg-dark-panel2 text-dark-text hover:border-cm-purple/70",
  ghost: "text-dark-muted hover:bg-dark-panel2 hover:text-dark-text",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean; icon?: ReactNode };

export function Button({ variant = "secondary", busy = false, icon, className, children, disabled, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type || "button"}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx("inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50", VARIANTS[variant], focusRing, className)}
      {...rest}
    >
      {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

export function Pill({ tone = "neutral", children, title }: { tone?: "neutral" | "good" | "warn" | "bad"; children: ReactNode; title?: string }) {
  const tones = {
    neutral: "border-dark-border bg-dark-panel2 text-dark-muted",
    good: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    warn: "border-dark-warn/40 bg-dark-warn/10 text-dark-warn",
    bad: "border-dark-danger/40 bg-dark-danger/10 text-dark-danger",
  };
  return (
    <span title={title} className={cx("inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-sm leading-5", tones[tone])}>
      {children}
    </span>
  );
}

export function Panel({ title, aside, children, className }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl border border-dark-border bg-dark-panel p-4 sm:p-5", className)}>
      {(title || aside) && (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          {title ? <h2 className="text-base font-semibold text-dark-text">{title}</h2> : <span />}
          {aside ? <div className="text-sm text-dark-muted">{aside}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-dark-muted" role="status">
      <Loader2 size={18} className="animate-spin text-cm-purple" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-dark-danger/40 bg-dark-danger/10 px-3 py-2.5 text-sm leading-6 text-dark-danger">
      <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 whitespace-pre-line break-words">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className={cx("-my-1.5 min-h-9 shrink-0 rounded-md px-2 font-medium underline underline-offset-2 hover:no-underline", focusRing)}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  const tones = { info: "border-cm-purple/30 bg-cm-purple/10 text-dark-text", warn: "border-dark-warn/50 bg-dark-warn/10 text-dark-text" };
  return <div className={cx("rounded-lg border px-3 py-2.5 text-sm leading-6", tones[tone])}>{children}</div>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (next: T) => void; items: { key: T; label: string }[] }) {
  return (
    <div role="tablist" aria-label="Dashboard sections" className="flex gap-1 overflow-x-auto rounded-lg border border-dark-border bg-dark-panel2 p-1">
      {items.map((item) => (
        <button
          key={item.key}
          role="tab"
          type="button"
          aria-selected={item.key === value}
          onClick={() => onChange(item.key)}
          className={cx(
            "min-h-9 flex-1 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors",
            item.key === value ? "bg-dark-panel text-dark-text shadow-sm" : "text-dark-muted hover:text-dark-text",
            focusRing
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
