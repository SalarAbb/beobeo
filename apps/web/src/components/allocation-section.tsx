"use client";

import { useState, useSyncExternalStore } from "react";
import { allocationDrift, fillToTarget, type TargetMix } from "@beobeo/core/allocation";
import { AllocationDonut, allocationSlices } from "@/components/charts/allocation-donut";
import { Section } from "@/components/page-section";
import { usePortfolio } from "@/components/portfolio-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fmtUsd, useVizTheme } from "@/lib/viz";

/** Drift (in weight points) past which a row is flagged — the common
 *  Bogleheads "5/25" band's absolute half. */
const FLAG_DRIFT = 0.05;
/** Within this, the verdict says "on target". */
const ON_TARGET = 0.02;

// Target mixes live on this device for now ({SYMBOL: percent}), keyed per
// user and portfolio scope. A tiny external store over localStorage, like
// the portfolio switcher: no setState-in-effect, SSR snapshot null.
const listeners = new Set<() => void>();
const targetStore = {
  get: (key: string): string | null =>
    typeof window === "undefined" ? null : localStorage.getItem(key),
  set: (key: string, pcts: Record<string, number> | null) => {
    if (pcts) localStorage.setItem(key, JSON.stringify(pcts));
    else localStorage.removeItem(key);
    listeners.forEach((l) => l());
  },
  subscribe: (cb: () => void) => {
    listeners.add(cb);
    window.addEventListener("storage", cb);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", cb);
    };
  },
};

function parsePcts(raw: string | null): Record<string, number> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && v > 0) out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** The saved target mix for the current user and portfolio scope, as
 *  fractions keyed by symbol; null when none is set. */
export function useTargetMix(): TargetMix | null {
  const { userId, portfolioId } = usePortfolio();
  const raw = useSyncExternalStore(
    targetStore.subscribe,
    () => targetStore.get(`beobeo.targets.${userId}.${portfolioId ?? "all"}`),
    () => null,
  );
  const pcts = parsePcts(raw);
  return pcts ? Object.fromEntries(Object.entries(pcts).map(([s, p]) => [s, p / 100])) : null;
}

/** Whole-number percents that add up to 100 (largest remainder) — the
 *  editor's starting point when no target exists yet. */
function roundedWeights(holdings: { symbol: string; value: number }[]) {
  const total = holdings.reduce((s, h) => s + h.value, 0);
  if (total <= 0) return {};
  const parts = holdings.map((h) => {
    const exact = (h.value / total) * 100;
    return { symbol: h.symbol, pct: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let left = 100 - parts.reduce((s, p) => s + p.pct, 0);
  for (const p of [...parts].sort((a, b) => b.frac - a.frac)) {
    if (left-- <= 0) break;
    p.pct++;
  }
  return Object.fromEntries(parts.map((p) => [p.symbol, p.pct]));
}

const pts = (drift: number) => {
  const v = drift * 100;
  if (Math.abs(v) < 0.05) return "0.0";
  return `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;
};

/**
 * Dashboard "Allocation" section. Without a target mix it's the donut with
 * labels and a "Set a target mix" action. With one, it leads with a verdict
 * ("VXUS is 2.1 points under its 30% target"), shows now vs. target per
 * holding, and says where the next deposit goes (`fillToTarget`: tops up
 * the most underweight first, never needs a sell).
 */
export function AllocationSection({
  holdings,
  lastDeposit,
}: {
  holdings: { symbol: string; value: number }[];
  /** Size of the most recent net deposit, the default "next deposit". */
  lastDeposit: number | null;
}) {
  const theme = useVizTheme();
  const { userId, portfolioId } = usePortfolio();
  const storageKey = `beobeo.targets.${userId}.${portfolioId ?? "all"}`;
  const raw = useSyncExternalStore(
    targetStore.subscribe,
    () => targetStore.get(storageKey),
    () => null,
  );
  const saved = parsePcts(raw);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [deposit, setDeposit] = useState<string | null>(null);

  const { colorFor } = allocationSlices(holdings, theme);
  const startEditing = () => {
    const start = saved ?? roundedWeights(holdings);
    const symbols = new Set([...holdings.map((h) => h.symbol), ...Object.keys(start)]);
    setDraft(Object.fromEntries([...symbols].map((s) => [s, String(start[s] ?? 0)])));
  };

  const aside = draft ? null : (
    <Button variant="ghost" size="sm" className="h-7 rounded-full" onClick={startEditing}>
      {saved ? "Edit target mix" : "Set a target mix"}
    </Button>
  );

  if (draft) {
    const sum = Object.values(draft).reduce((s, v) => s + (Number(v) || 0), 0);
    const valid =
      Math.abs(sum - 100) < 0.01 && Object.values(draft).every((v) => Number(v) >= 0);
    const save = () => {
      const pcts = Object.fromEntries(
        Object.entries(draft)
          .map(([s, v]) => [s, Number(v)] as const)
          .filter(([, v]) => v > 0),
      );
      targetStore.set(storageKey, pcts);
      setDraft(null);
    };
    return (
      <Section title="Allocation">
        <div className="grid max-w-sm gap-4">
          <p className="text-sm text-muted-foreground">
            What share of this portfolio should each holding be? The numbers need to add
            up to 100.
          </p>
          <ul className="grid gap-2">
            {Object.entries(draft).map(([symbol, v]) => (
              <li key={symbol} className="flex items-center gap-3">
                <span
                  className="size-2.5 shrink-0 rounded-[3px]"
                  style={{ background: colorFor(symbol) }}
                />
                <span className="w-16 text-sm font-medium">{symbol}</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="any"
                  value={v}
                  aria-label={`${symbol} target percent`}
                  onChange={(e) => setDraft({ ...draft, [symbol]: e.target.value })}
                  className="data h-8 w-24 text-right"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </li>
            ))}
          </ul>
          <p className={cn("text-sm", valid ? "text-muted-foreground" : "text-warn")}>
            Adds up to <span className="data">{Number(sum.toFixed(2))}%</span>
            {!valid && " — needs 100"}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!valid} onClick={save}>
              Save target mix
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            {saved && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-muted-foreground"
                onClick={() => {
                  targetStore.set(storageKey, null);
                  setDraft(null);
                }}
              >
                Remove target mix
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Saved on this device.</p>
        </div>
      </Section>
    );
  }

  if (!saved) {
    return (
      <Section title="Allocation" aside={aside}>
        <AllocationDonut data={holdings} />
      </Section>
    );
  }

  const mix: TargetMix = Object.fromEntries(
    Object.entries(saved).map(([s, p]) => [s, p / 100]),
  );
  const keyed = holdings.map((h) => ({ key: h.symbol, value: h.value }));
  const { rows } = allocationDrift(keyed, mix);
  const worst = rows.reduce((a, b) => (Math.abs(b.drift) > Math.abs(a.drift) ? b : a));
  const verdict =
    Math.abs(worst.drift) < ON_TARGET ? (
      <>You&apos;re on target: every holding is within 2 points of your mix.</>
    ) : worst.target === 0 ? (
      <>
        {worst.key} is <span className="data">{(worst.current * 100).toFixed(1)}%</span> of
        this portfolio but has no target.
      </>
    ) : (
      <>
        Furthest off: {worst.key} is{" "}
        <span className="data">{Math.abs(worst.drift * 100).toFixed(1)}</span> points{" "}
        {worst.drift > 0 ? "over" : "under"} its{" "}
        <span className="data">{Number((worst.target * 100).toFixed(2))}%</span> target.
      </>
    );

  const depositStr = deposit ?? String(Math.round(lastDeposit ?? 1000));
  const depositUsd = Number(depositStr) || 0;
  const plan = fillToTarget(keyed, mix, depositUsd);
  const scale = Math.max(...rows.map((r) => Math.max(r.current, r.target)), 0.01);

  return (
    <Section title="Allocation" aside={aside}>
      <p className="text-sm">{verdict}</p>
      <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
        <AllocationDonut data={holdings} legend={false} />
        <table className="min-w-0 flex-1 text-sm sm:max-w-md">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="pb-2 text-left font-normal">Holding</th>
              <th className="pb-2 text-right font-normal">Now</th>
              <th className="pb-2 text-right font-normal">Target</th>
              <th className="hidden w-28 pb-2 sm:table-cell" aria-hidden />
              <th className="pb-2 text-right font-normal">Off by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t">
                <td className="py-1.5">
                  <span className="flex items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-[3px]"
                      style={{ background: colorFor(r.key) }}
                    />
                    <span className="font-medium">{r.key}</span>
                  </span>
                </td>
                <td className="data py-1.5 text-right">{(r.current * 100).toFixed(1)}%</td>
                <td className="data py-1.5 text-right text-muted-foreground">
                  {r.target > 0 ? `${Number((r.target * 100).toFixed(2))}%` : "—"}
                </td>
                {/* bullet bar: fill = now, tick = target, one scale per table */}
                <td className="hidden py-1.5 pl-4 sm:table-cell" aria-hidden>
                  <div className="relative h-3">
                    <div className="absolute inset-x-0 top-1 h-1 rounded-full bg-muted" />
                    <div
                      className="absolute top-1 left-0 h-1 rounded-full"
                      style={{
                        width: `${(r.current / scale) * 100}%`,
                        background: colorFor(r.key),
                      }}
                    />
                    {r.target > 0 && (
                      <div
                        className="absolute top-0 h-3 w-0.5 -translate-x-1/2 bg-foreground"
                        style={{ left: `${(r.target / scale) * 100}%` }}
                      />
                    )}
                  </div>
                </td>
                <td
                  className={cn(
                    "data py-1.5 text-right",
                    Math.abs(r.drift) >= FLAG_DRIFT ? "text-warn" : "text-muted-foreground",
                  )}
                >
                  {pts(r.drift)} pts
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-2 border-t pt-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <label htmlFor="next-deposit">Your next deposit of</label>
          <span className="relative">
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground">
              $
            </span>
            <Input
              id="next-deposit"
              type="number"
              inputMode="decimal"
              min={0}
              value={depositStr}
              onChange={(e) => setDeposit(e.target.value)}
              className="data h-8 w-28 pl-6"
            />
          </span>
          <span>
            {plan.length === 0
              ? "— enter an amount to see where it goes."
              : plan.length === 1
                ? "goes all into"
                : "goes into"}
          </span>
          {plan.map((p, i) => (
            <span key={p.key}>
              <span className="font-medium">{p.key}</span>{" "}
              <span className="data">{fmtUsd(p.amountUsd)}</span>
              {i < plan.length - 1 && <span className="text-muted-foreground"> · </span>}
            </span>
          ))}
        </div>
        {plan.length > 0 && (
          <p className="text-xs text-muted-foreground">
            The most underweight holdings get topped up first, so you move toward your mix
            without selling anything.
          </p>
        )}
      </div>
    </Section>
  );
}
