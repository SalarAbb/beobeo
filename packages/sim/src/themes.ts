/**
 * How the loop decides what matters. PLAN.md principle 12: an ask that
 * appears across personas beats one loud persona; an ask that recurs across
 * days beats a single day. Praise never scores (it's a "keep", not a "do").
 */
export interface ThemeStats {
  key: string;
  title: string;
  area: string;
  kind: string;
  status: string;
  /** Distinct personas who raised it (all-time). */
  personas: number;
  /** Distinct days it was raised. */
  days: number;
  /** Sightings in the digest window. */
  recent: number;
  avgSeverity: number;
  maxSeverity: number;
}

/** The score's components, exposed so the evolution page can show why a theme ranks where it does. */
export function scoreParts(t: ThemeStats): { breadth: number; persistence: number; pain: number; regression: number } {
  if (t.kind === "praise" || t.status === "wontfix") return { breadth: 0, persistence: 0, pain: 0, regression: 0 };
  return {
    breadth: t.personas * 3,
    persistence: Math.log2(1 + t.days) * 2,
    pain: t.avgSeverity + (t.maxSeverity >= 5 ? 3 : 0),
    // A shipped theme that is still being raised is a failed fix — bump it.
    regression: t.status === "open" && t.recent > 0 ? 1 : 0,
  };
}

export function themeScore(t: ThemeStats): number {
  const p = scoreParts(t);
  return Math.round((p.breadth + p.persistence + p.pain + p.regression) * 10) / 10;
}

export function rankThemes(ts: ThemeStats[]): (ThemeStats & { score: number })[] {
  return ts
    .map((t) => ({ ...t, score: themeScore(t) }))
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

/** p-th percentile (nearest-rank) of a sample. */
export function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}

/** PLAN.md principle 5 budgets, ms. */
export const LATENCY_BUDGETS: Record<string, number> = {
  "trpc:portfolio.overview": 500,
  "trpc:portfolio.timeseries": 500,
  "trpc:transactions.create": 300,
  "auth:sign-in": 1000,
  "chat:first-token": 1500,
  page: 1500,
  interact: 1000,
  signup: 3000,
};

export function budgetFor(target: string): number | undefined {
  return LATENCY_BUDGETS[target] ?? (target.startsWith("page:") ? LATENCY_BUDGETS.page : target.startsWith("interact:") ? LATENCY_BUDGETS.interact : undefined);
}
