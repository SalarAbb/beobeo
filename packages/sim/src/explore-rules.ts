import type { Persona } from "./persona";

/** Top-level app areas a persona can wander into; deeper pages are reached by clicking. */
export const ROUTES = ["/dashboard", "/transactions", "/tax-center", "/compare", "/chat", "/accounts", "/account"] as const;

/** Deterministic PRNG (mulberry32): a persona's exploration on a given day is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function pickWeighted<T>(rng: () => number, items: { item: T; weight: number }[]): T | null {
  const total = items.reduce((s, x) => s + Math.max(0, x.weight), 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const x of items) {
    r -= Math.max(0, x.weight);
    if (r < 0) return x.item;
  }
  return items.at(-1)!.item;
}

export interface ExploreProfile {
  /** Probability this persona wanders around the app on a given day. */
  chance: number;
  /** Actions per session. */
  steps: number;
  /** Relative weights over ROUTES when jumping to an area. */
  affinity: Record<string, number>;
}

/** Explicit `explore` config wins; otherwise curiosity scales with tech comfort. */
export function exploreProfile(p: Persona): ExploreProfile {
  if (p.explore) return { ...p.explore, affinity: { ...Object.fromEntries(ROUTES.map((r) => [r, 0])), ...p.explore.affinity } };
  return {
    chance: Math.min(0.9, 0.15 + 0.15 * p.techSavviness),
    steps: 4 + 2 * p.techSavviness,
    affinity: Object.fromEntries(ROUTES.map((r) => [r, 1])),
  };
}

/**
 * Controls the explorer must never touch: anything that commits, deletes,
 * spends (chat sends call the paid agent), or leaves. Exploration looks and
 * pokes; it never changes the persona's data. Habit and judgment trades go
 * through the API on purpose.
 */
const BLOCKED = /\b(delete|remove|sign ?out|log ?out|save|create|import|confirm|submit|rename|apply|reset|clear|send|new portfolio|add account|upload|connect)\b/i;

export function isSafeTarget(t: { name: string; role: string | null; href: string | null; tag: string }): boolean {
  if (!t.name.trim()) return false; // unlabeled: we can't know what it does (it may delete)
  if (BLOCKED.test(t.name)) return false;
  if (t.name.trim().endsWith("?")) return false; // suggested chat prompts send a paid assistant turn
  if (t.role === "combobox" || t.role === "option" || t.tag === "select") return false; // e.g. account-type selects save instantly
  if (t.href !== null) {
    if (!t.href.startsWith("/") || t.href.startsWith("//")) return false; // external
    if (/^\/(api|signin|signup)\b/.test(t.href)) return false;
  }
  return true;
}

/** /positions/9f2c… → /positions/:id, so themes and timings group by page, not by asset. */
export function routeKey(pathname: string): string {
  return pathname.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "/:id").replace(/\/$/, "") || "/";
}
