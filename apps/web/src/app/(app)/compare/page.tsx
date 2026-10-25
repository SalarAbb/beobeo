"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { AssetLogo } from "@/components/asset-logo";
import { usePortfolio } from "@/components/portfolio-context";
import { CompareChart, benchColor } from "@/components/charts/compare-chart";
import { AssetPicker } from "@/components/transactions/asset-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";
import { fmtUsd, gainClass, useVizTheme } from "@/lib/viz";
import { cn } from "@/lib/utils";

interface BenchAsset {
  id: string;
  symbol: string;
  name: string;
  class: string;
}

const fmtXirr = (v: number | null) =>
  v === null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}% / yr`;

const fmtSignedPct = (v: number | null) =>
  v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const fmtAbsPct = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}%`);
const fmtRatio = (v: number | null) => (v === null ? "—" : v.toFixed(2));

/** Metric bundle each series carries (see seriesMetrics on the server). */
interface SeriesMetrics {
  twr: number | null;
  twrAnnualized: number | null;
  volatility: number | null;
  maxDrawdown: number | null;
  sharpe: number | null;
}

interface MetricColumn {
  key: string;
  label: string;
  color: string;
  xirr: number | null; // fraction, as elsewhere on this page
  metrics: SeriesMetrics;
}

/** Row spec: plain-English name first, technical term + one-line layman
 *  explainer beside/under it — jargon never stands alone. */
const METRIC_ROWS: {
  name: string;
  term: string;
  explainer: string;
  value: (c: MetricColumn) => number | null;
  format: (v: number | null) => string;
  /** Which direction wins the subtle per-row emphasis. */
  better: "high" | "low";
  signed: boolean;
}[] = [
  {
    name: "Annual return",
    term: "XIRR",
    explainer: "what the same money earns per year",
    value: (c) => (c.xirr === null ? null : c.xirr * 100),
    format: fmtSignedPct,
    better: "high",
    signed: true,
  },
  {
    name: "Total return",
    term: "TWR",
    explainer: "overall growth, ignoring deposit timing",
    value: (c) => c.metrics.twr,
    format: fmtSignedPct,
    better: "high",
    signed: true,
  },
  {
    name: "Volatility",
    term: "",
    explainer: "bumpiness of the ride — lower is calmer",
    value: (c) => c.metrics.volatility,
    format: fmtAbsPct,
    better: "low",
    signed: false,
  },
  {
    name: "Biggest drop",
    term: "max drawdown",
    explainer: "deepest fall from a peak along the way",
    value: (c) => c.metrics.maxDrawdown,
    format: fmtAbsPct,
    better: "high", // less negative = shallower fall = better
    signed: false,
  },
  {
    name: "Risk-adjusted",
    term: "Sharpe",
    explainer: "reward per unit of risk — above 1 is good",
    value: (c) => c.metrics.sharpe,
    format: fmtRatio,
    better: "high",
    signed: false,
  },
];

function MetricsTable({ columns }: { columns: MetricColumn[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4 font-normal text-muted-foreground">
              Metric
            </th>
            {columns.map((c) => (
              <th key={c.key} className="px-3 py-2 text-right font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{ background: c.color }}
                  />
                  {c.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRIC_ROWS.map((row) => {
            const values = columns.map(row.value);
            const present = values.filter((v): v is number => v !== null);
            const best =
              present.length > 1
                ? row.better === "high"
                  ? Math.max(...present)
                  : Math.min(...present)
                : null;
            return (
              <tr key={row.name} className="border-b last:border-0">
                <td className="max-w-56 py-2.5 pr-4">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-sm font-medium">{row.name}</span>
                    {row.term && (
                      <span className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                        {row.term}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    {row.explainer}
                  </p>
                </td>
                {columns.map((c, i) => {
                  const v = values[i]!;
                  return (
                    <td
                      key={c.key}
                      className={cn(
                        "data px-3 py-2.5 text-right text-[13px]",
                        row.signed && gainClass(v),
                        // Subtle emphasis on the best value — weight, never
                        // color (color follows the entity, not its rank).
                        v !== null && v === best && "font-semibold",
                      )}
                    >
                      {row.format(v)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ComparePage() {
  const trpc = useTRPC();
  const theme = useVizTheme();
  const presets = useQuery(trpc.compare.presets.queryOptions());
  const { portfolioId } = usePortfolio();
  const overview = useQuery(
    trpc.portfolio.overview.queryOptions({ portfolioId: portfolioId ?? undefined }),
  );

  const [selectedIds, setSelectedIds] = useState<string[] | null>(null); // null → default to first preset
  const [customBenchmarks, setCustomBenchmarks] = useState<BenchAsset[]>([]);
  const [scopeIds, setScopeIds] = useState<string[]>([]); // empty = whole portfolio
  const [addingCustom, setAddingCustom] = useState(false);

  const chips: BenchAsset[] = useMemo(() => {
    const presetChips = presets.data ?? [];
    const seen = new Set(presetChips.map((p) => p.id));
    return [...presetChips, ...customBenchmarks.filter((c) => !seen.has(c.id))];
  }, [presets.data, customBenchmarks]);

  const activeIds =
    selectedIds ?? (presets.data?.[0] ? [presets.data[0].id] : []);

  function toggleBenchmark(id: string) {
    const next = activeIds.includes(id)
      ? activeIds.filter((x) => x !== id)
      : activeIds.length >= 4
        ? activeIds // cap at 4
        : [...activeIds, id];
    if (next.length >= 1) setSelectedIds(next);
  }

  function toggleScope(assetId: string) {
    setScopeIds((prev) =>
      prev.includes(assetId)
        ? prev.filter((x) => x !== assetId)
        : [...prev, assetId],
    );
  }

  const compare = useQuery({
    ...trpc.compare.dca.queryOptions({
      benchmarkIds: activeIds,
      scopeAssetIds: scopeIds.length > 0 ? scopeIds : undefined,
      portfolioId: portfolioId ?? undefined,
    }),
    enabled: activeIds.length > 0,
    staleTime: 5 * 60_000,
  });

  const data = compare.data;
  const lastP = data?.portfolio[data.portfolio.length - 1];
  const holdings = overview.data?.holdings ?? [];
  const scopeLabel =
    scopeIds.length === 0
      ? "Whole portfolio"
      : holdings
          .filter((h) => scopeIds.includes(h.assetId))
          .map((h) => h.symbol)
          .join(" + ") || "Selection";

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <div>
        <h1 className="text-3xl">Compare</h1>
        <p className="text-sm text-muted-foreground">
          What if every dollar you invested — same dates, same amounts — had
          gone into a benchmark instead?
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Benchmarks:</span>
        {presets.isLoading && <Skeleton className="h-8 w-64" />}
        {chips.map((p) => {
          const activeIdx = activeIds.indexOf(p.id);
          const active = activeIdx !== -1;
          const color = active ? benchColor(theme, activeIdx) : undefined;
          return (
            <Button
              key={p.id}
              variant="outline"
              size="sm"
              aria-pressed={active}
              title={
                active
                  ? "Click to remove from comparison"
                  : activeIds.length >= 4
                    ? "Up to 4 benchmarks — remove one first"
                    : "Click to add to comparison"
              }
              className={cn(
                "h-8 gap-1.5 transition-all",
                active
                  ? "bg-secondary font-semibold"
                  : "opacity-55 hover:opacity-100",
              )}
              style={
                active
                  ? { borderColor: color, boxShadow: `inset 0 0 0 1px ${color}` }
                  : undefined
              }
              onClick={() => toggleBenchmark(p.id)}
            >
              <AssetLogo symbol={p.symbol} assetClass={p.class} size={16} />
              {p.symbol}
              {active && (
                <Check className="size-3.5" style={{ color }} strokeWidth={3} />
              )}
            </Button>
          );
        })}
        {addingCustom ? (
          <div className="flex w-64 items-center gap-1">
            <AssetPicker
              value={null}
              onChange={(a) => {
                setCustomBenchmarks((prev) =>
                  prev.some((c) => c.id === a.id) ? prev : [...prev, a],
                );
                setSelectedIds(
                  activeIds.includes(a.id) || activeIds.length >= 4
                    ? activeIds
                    : [...activeIds, a.id],
                );
                setAddingCustom(false);
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Cancel adding a benchmark"
              onClick={() => setAddingCustom(false)}
            >
              <X aria-hidden className="size-4" />
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-muted-foreground"
            onClick={() => setAddingCustom(true)}
          >
            <Plus className="mr-1 size-3.5" /> Add benchmark
          </Button>
        )}

        <span className="ml-auto" />
        <span className="text-sm text-muted-foreground">Comparing:</span>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-8",
                scopeIds.length > 0 && "border-primary bg-secondary font-semibold",
              )}
            >
              {scopeLabel}
              <ChevronDown className="ml-1 size-3.5 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="end">
            <button
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary",
                scopeIds.length === 0 && "font-semibold",
              )}
              onClick={() => setScopeIds([])}
            >
              Whole portfolio
            </button>
            <div className="my-1 border-t" />
            {holdings.map((h) => (
              <button
                key={h.assetId}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary"
                onClick={() => toggleScope(h.assetId)}
              >
                <input
                  type="checkbox"
                  readOnly
                  checked={scopeIds.includes(h.assetId)}
                  className="accent-primary"
                />
                <AssetLogo symbol={h.symbol} assetClass={h.class} size={18} />
                <span className="font-medium">{h.symbol}</span>
              </button>
            ))}
            {holdings.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                No holdings yet
              </p>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {compare.isLoading || !data ? (
        <Skeleton className="h-96 w-full" />
      ) : data.portfolio.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {scopeIds.length > 0
              ? "No transactions in the selected assets."
              : "Add some transactions first — the comparison replays your actual purchase history."}
          </CardContent>
        </Card>
      ) : (
        <>
          <div
            className={cn(
              "grid gap-4",
              data.benchmarks.length <= 1
                ? "grid-cols-2"
                : "grid-cols-2 lg:grid-cols-3",
            )}
          >
            <Card className="py-4">
              <CardContent className="px-4">
                <p className="text-xs text-muted-foreground">
                  {scopeIds.length === 0 ? "Your portfolio" : scopeLabel}
                </p>
                <p className="figure mt-1 text-2xl">
                  {fmtUsd(lastP?.value ?? null)}
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="data">{fmtXirr(data.portfolioXirr)}</span> · invested{" "}
                  <span className="data">{fmtUsd(lastP?.invested ?? null, 0)}</span>
                </p>
              </CardContent>
            </Card>
            {data.benchmarks.map((b, i) => {
              const last = b.series[b.series.length - 1];
              const delta =
                lastP && last ? lastP.value - last.value : null;
              return (
                <Card key={b.assetId} className="py-4">
                  <CardContent className="px-4">
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span
                        className="inline-block size-2 rounded-full"
                        style={{ background: benchColor(theme, i) }}
                      />
                      {b.symbol} (same cash flows)
                    </p>
                    <p className="figure mt-1 text-2xl">
                      {fmtUsd(last?.value ?? null)}
                    </p>
                    <p className="text-xs">
                      <span className="text-muted-foreground">
                        <span className="data">{fmtXirr(b.xirr)}</span> · your edge{" "}
                      </span>
                      <span className={cn("data font-medium", gainClass(delta))}>
                        {delta !== null && delta > 0 ? "+" : ""}
                        {fmtUsd(delta)}
                      </span>
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                Dollar-cost-average comparison
                {scopeIds.length > 0 && (
                  <span className="ml-2 font-sans text-sm font-normal text-muted-foreground">
                    {scopeLabel} only
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CompareChart
                portfolio={data.portfolio}
                portfolioLabel={scopeIds.length === 0 ? "Your portfolio" : scopeLabel}
                benchmarks={data.benchmarks.map((b) => ({
                  label: b.symbol,
                  series: b.series,
                }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                Head to head
                <span className="ml-2 font-sans text-sm font-normal text-muted-foreground">
                  same dollars, same dates — only the asset differs
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MetricsTable
                columns={[
                  {
                    key: "you",
                    label: scopeIds.length === 0 ? "You" : scopeLabel,
                    color: theme.series[0]!,
                    xirr: data.portfolioXirr,
                    metrics: data.portfolioMetrics,
                  },
                  ...data.benchmarks.map((b, i) => ({
                    key: b.assetId,
                    label: b.symbol,
                    color: benchColor(theme, i),
                    xirr: b.xirr,
                    metrics: b.metrics,
                  })),
                ]}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
