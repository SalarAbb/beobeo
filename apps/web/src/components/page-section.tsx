import type { ReactNode } from "react";

/** Page title row: serif h1 (via the base rule), an optional quiet subtitle,
 *  and actions pushed to the right. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="min-w-0">
        <h1 className="text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** A quiet chapter: serif title over a hairline rule, content on the page
 *  background — no card, no shadow (the evolution page's section style). */
export function Section({
  title,
  aside,
  children,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid min-w-0 gap-5">
      <div className="flex items-baseline justify-between gap-3 border-b pb-2.5">
        <h2 className="font-display text-lg font-bold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Hairline-ruled strip of stat tiles (cells separated by 1px gaps over the
 *  border color). `cols` sets the column classes for the tile count. */
export function StatStrip({
  cols = "grid-cols-2 lg:grid-cols-4",
  className,
  children,
}: {
  cols?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`grid gap-px overflow-hidden rounded-xl border bg-border ${cols} ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

/** One cell of a StatStrip. `hero` values use the display serif — the one
 *  place it carries data; the rest stay in mono. */
export function StatTile({
  label,
  value,
  sub,
  tone,
  hero = true,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  hero?: boolean;
}) {
  return (
    <div className="min-w-0 bg-card px-5 py-4">
      <p className="eyebrow">{label}</p>
      <p
        className={`mt-2 truncate tabular-nums ${
          hero
            ? "font-display text-2xl font-bold sm:text-[28px]"
            : "font-mono text-lg font-medium"
        } ${tone ?? ""}`}
      >
        {value}
      </p>
      {sub && (
        <p className={`mt-0.5 font-mono text-xs ${tone ?? "text-muted-foreground"}`}>{sub}</p>
      )}
    </div>
  );
}
