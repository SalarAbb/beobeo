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
    <section className="grid min-w-0 grid-cols-1 gap-5">
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

/** One cell of a StatStrip. The value is a headline figure (display serif);
 *  `hero` makes it larger. The sub-line is data (mono). See `.figure`/`.data` in globals.css. */
export function StatTile({
  label,
  value,
  sub,
  tone,
  subTone,
  hero = true,
  className,
}: {
  label: ReactNode;
  value: string;
  sub?: ReactNode;
  tone?: string;
  /** Defaults to `tone` (a delta under a value); set it when the sub-line is a description. */
  subTone?: string;
  hero?: boolean;
  /** Grid placement, e.g. a column span to fill an odd row. */
  className?: string;
}) {
  return (
    <div className={`min-w-0 bg-card px-4 py-4 sm:px-5 ${className ?? ""}`}>
      <p className="eyebrow truncate">{label}</p>
      <p
        className={`figure mt-2 truncate ${hero ? "text-[22px] sm:text-[28px]" : "text-xl"} ${tone ?? ""}`}
      >
        {value}
      </p>
      {sub && (
        <p className={`data mt-0.5 text-xs ${subTone ?? tone ?? "text-muted-foreground"}`}>
          {sub}
        </p>
      )}
    </div>
  );
}
