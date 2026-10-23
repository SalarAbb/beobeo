"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Ruler } from "lucide-react";
import Link from "next/link";
import { AssetLogo } from "@/components/asset-logo";
import { usePortfolio } from "@/components/portfolio-context";
import { AllocationDonut } from "@/components/charts/allocation-donut";
import { ValueChart } from "@/components/charts/value-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTRPC } from "@/lib/trpc";
import { fmtPct, fmtQty, fmtUsd, gainClass } from "@/lib/viz";

type PnlWindow = "1d" | "1w" | "1m" | "ytd" | "1y" | "all";

const WINDOWS: { value: PnlWindow; label: string }[] = [
  { value: "1d", label: "1D" },
  { value: "1w", label: "1W" },
  { value: "1m", label: "1M" },
  { value: "ytd", label: "YTD" },
  { value: "1y", label: "1Y" },
  { value: "all", label: "All" },
];

type SortKey = "symbol" | "quantity" | "price" | "marketValue" | "pl";
type SortState = { key: SortKey; dir: "asc" | "desc" };

interface SortableHolding {
  symbol: string;
  quantity: number;
  price: number | null;
  marketValue: number | null;
  unrealizedGain: number | null;
  periodGain: number | null;
}

function sortHoldings<T extends SortableHolding>(
  holdings: T[],
  sort: SortState,
  windowed: boolean,
): T[] {
  const val = (h: SortableHolding): string | number | null =>
    sort.key === "pl" ? (windowed ? h.periodGain : h.unrealizedGain) : h[sort.key];
  return [...holdings].sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1; // nulls last regardless of direction
    if (bv === null) return -1;
    const cmp =
      typeof av === "string" ? av.localeCompare(bv as string) : av - (bv as number);
    return sort.dir === "asc" ? cmp : -cmp;
  });
}

function SortableHead({
  label,
  sortKey,
  sort,
  onSort,
  className,
  align = "right",
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (k: SortKey) => void;
  className?: string;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  return (
    <TableHead className={`${align === "right" ? "text-right" : ""} ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${
          active ? "text-foreground" : ""
        }`}
      >
        {label}
        <span aria-hidden className="w-2.5 text-[9px]">
          {active ? (sort.dir === "desc" ? "▼" : "▲") : ""}
        </span>
      </button>
    </TableHead>
  );
}

/** Unsigned percent (volatility-style magnitudes). */
const fmtPctAbs = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v.toFixed(2)}%`;

/**
 * Explainers interpret the user's own number in plain words instead of
 * defining the term ("fair reward for the risk" beats "return per unit of
 * risk"). Thresholds are the standard rules of thumb.
 */
const explainSharpe = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return "reward earned for the risk taken";
  if (v < 0) return "you took risk but earned less than cash";
  if (v < 0.5) return "low reward for the risk you're taking";
  if (v < 1) return "fair reward for the risk — above 1 is good";
  if (v < 2) return "good reward for the risk you're taking";
  return "excellent reward for the risk you're taking";
};

/** The S&P 500's long-run annualized volatility — the layman's yardstick. */
const MARKET_VOL = 15;

const explainVolatility = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return "how much your value swings around";
  if (v < 12) return "your value swings less than the stock market";
  if (v < 20) return "your value swings about as much as the market";
  return `swings ${(v / MARKET_VOL).toFixed(1)}× more than the stock market`;
};

const explainTwr = (v: number | null | undefined): string =>
  v === null || v === undefined
    ? "how your picks did, ignoring your timing"
    : `every $1 your picks held became $${(1 + v / 100).toFixed(2)}`;

const explainTopPosition = (pct: number | null): string => {
  if (pct === null) return "how much rides on a single holding";
  if (pct >= 40) return "very concentrated — this one drives your results";
  if (pct >= 25) return "a big share of your money on one bet";
  return "no single holding dominates your portfolio";
};

/** Hover-card copy: ONE plain sentence of meaning + a short yardstick the
 *  reader can judge their own number against. Concise on purpose. */
const METRIC_DETAILS = {
  xirr: {
    meaning: "Average yearly growth of your money, counting every deposit and when you made it.",
    yardstick: "savings ~4% · stock market ~10%/yr",
  },
  twr: {
    meaning: "Growth of your picks alone — as if $1 sat untouched from day one.",
    yardstick: "the fair number to compare with an index fund",
  },
  timing: {
    meaning: "The part of your return caused purely by when you added or removed money.",
    yardstick: "most investors lose 1–3%/yr to timing",
  },
  sharpe: {
    meaning: "Reward earned for every unit of ups-and-downs you sat through.",
    yardstick: "0.5 low · 1 solid · 2+ excellent",
  },
  volatility: {
    meaning: "Typical size of your portfolio's yearly swings, up and down.",
    yardstick: "the stock market swings ~15%",
  },
  topPosition: {
    meaning: "The slice of your money riding on your single biggest holding.",
    yardstick: "above 25%, one bet steers your results",
  },
  diversification: {
    meaning: "How many truly independent bets your holdings actually behave like.",
    yardstick: "closer to your holding count = better spread",
  },
} as const;

/**
 * One metric cell: a dotted-underlined plain-English label and the value —
 * nothing else, so the card stays airy. Hovering the cell opens a compact
 * structured hover card (user-driven design: concise, pretty, no jargon):
 * metric name → bold personalized takeaway → one-sentence meaning → a
 * yardstick row to judge the number against.
 */
function MetricCell({
  label,
  term,
  value,
  tone,
  insight,
  detail,
}: {
  label: string;
  term?: string;
  value: string;
  tone?: string;
  /** One-line reading of the user's own number ("fair reward for the risk"). */
  insight: string;
  detail: { meaning: string; yardstick: string };
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex min-w-0 cursor-help flex-col gap-1.5">
          <span className="self-start text-xs font-medium text-muted-foreground underline decoration-muted-foreground/40 decoration-dotted underline-offset-4">
            {label}
          </span>
          <span className={`text-xl font-semibold tabular-nums ${tone ?? ""}`}>
            {value}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="w-64 p-0">
        <div className="px-3.5 pt-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
            {term && <span className="opacity-60"> · {term}</span>}
          </p>
          <p className="mt-1 text-sm font-semibold leading-snug">{insight}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {detail.meaning}
          </p>
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 border-t px-3.5 py-2 text-[11px] text-muted-foreground">
          <Ruler aria-hidden className="size-3 shrink-0 opacity-60" />
          {detail.yardstick}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

interface HoldingWeight {
  symbol: string;
  marketValue: number | null;
}

/** Top-holding weight and effective number of independent positions (1/Σw²)
 *  — both derivable client-side from the holdings already on screen. */
function concentration(holdings: HoldingWeight[]): {
  topSymbol: string;
  topPct: number;
  effectiveN: number;
} | null {
  const valued = holdings.filter(
    (h): h is HoldingWeight & { marketValue: number } =>
      h.marketValue !== null && h.marketValue > 0,
  );
  const total = valued.reduce((s, h) => s + h.marketValue, 0);
  if (total <= 0 || valued.length === 0) return null;
  let top = valued[0]!;
  let sumSq = 0;
  for (const h of valued) {
    if (h.marketValue > top.marketValue) top = h;
    const w = h.marketValue / total;
    sumSq += w * w;
  }
  return {
    topSymbol: top.symbol,
    topPct: (top.marketValue / total) * 100,
    effectiveN: 1 / sumSq,
  };
}

function StatTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <Card className="py-4">
      <CardContent className="px-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold ${tone ?? ""}`}>{value}</p>
        {sub && <p className={`text-xs ${tone ?? "text-muted-foreground"}`}>{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const trpc = useTRPC();
  const { portfolioId, activeName } = usePortfolio();
  const [pnlWindow, setPnlWindow] = useState<PnlWindow>("all");
  const [sort, setSort] = useState<SortState>({ key: "marketValue", dir: "desc" });
  const scope = { portfolioId: portfolioId ?? undefined };
  const overview = useQuery({
    ...trpc.portfolio.overview.queryOptions({ ...scope, window: pnlWindow }),
    // keep showing the previous window's data while the new one loads
    placeholderData: keepPreviousData,
  });
  const timeseries = useQuery(trpc.portfolio.timeseries.queryOptions(scope));
  const metrics = useQuery({
    ...trpc.portfolio.metrics.queryOptions({ ...scope, window: pnlWindow }),
    placeholderData: keepPreviousData,
  });

  const windowed = pnlWindow !== "all";
  const windowLabel = WINDOWS.find((w) => w.value === pnlWindow)!.label;

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "desc" ? "asc" : "desc" }
        : { key, dir: key === "symbol" ? "asc" : "desc" },
    );

  if (overview.isLoading) {
    return (
      <div className="mx-auto grid max-w-5xl gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const data = overview.data;
  if (!data || data.holdings.length === 0) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <Card className="mt-6">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No holdings yet.{" "}
            <Link href="/transactions" className="underline">
              Add your first transaction
            </Link>{" "}
            to see your portfolio here.
          </CardContent>
        </Card>
      </div>
    );
  }

  const { totals } = data;

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <span className="text-sm text-muted-foreground">· {activeName}</span>
        <div className="ml-auto">
          <SegmentedControl value={pnlWindow} onChange={setPnlWindow} options={WINDOWS} />
        </div>
      </div>

      {data.dataIssues.length > 0 && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-muted-foreground">
          Some assets have inconsistent history and are excluded:{" "}
          {data.dataIssues.map((i) => i.symbol).join(", ")}. Check their
          transactions (a sell may exceed recorded buys).
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Portfolio value" value={fmtUsd(totals.value)} />
        {windowed ? (
          <StatTile
            label={`P/L · ${windowLabel}`}
            value={fmtUsd(totals.periodGain)}
            sub={fmtPct(totals.periodGainPct)}
            tone={gainClass(totals.periodGain)}
          />
        ) : (
          <StatTile
            label="Unrealized P/L"
            value={fmtUsd(totals.unrealized)}
            sub={fmtPct(totals.unrealizedPct)}
            tone={gainClass(totals.unrealized)}
          />
        )}
        <StatTile
          label={windowed ? `Realized P/L · ${windowLabel}` : "Realized P/L"}
          value={fmtUsd(totals.realized)}
          tone={gainClass(totals.realized)}
        />
        <StatTile
          label={windowed ? `Dividends · ${windowLabel}` : "Dividends"}
          value={fmtUsd(totals.dividends)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Portfolio over time</CardTitle>
        </CardHeader>
        <CardContent>
          {timeseries.isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <ValueChart data={timeseries.data ?? []} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Performance &amp; risk
            {windowed && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                · {windowLabel}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {metrics.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            (() => {
              const m = metrics.data;
              const conc = concentration(data.holdings);
              const gap = m?.behaviorGap ?? null;
              return (
                <TooltipProvider delayDuration={150}>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-7 lg:grid-cols-4">
                    <MetricCell
                      label="Annual return"
                      term="XIRR"
                      value={fmtPct(m?.xirr)}
                      insight="what your money actually earns per year"
                      detail={METRIC_DETAILS.xirr}
                      tone={gainClass(m?.xirr)}
                    />
                    <MetricCell
                      label="Total return"
                      term="TWR"
                      value={fmtPct(m?.twr)}
                      insight={explainTwr(m?.twr)}
                      detail={METRIC_DETAILS.twr}
                      tone={gainClass(m?.twr)}
                    />
                    <MetricCell
                      label="Timing impact"
                      term="behavior gap"
                      value={fmtPct(gap)}
                      insight={
                        gap === null
                          ? "when you added money — helped or hurt?"
                          : Math.abs(gap) < 0.005
                            ? "your timing made no difference"
                            : gap > 0
                              ? "your timing helped your returns"
                              : "your timing cost you returns"
                      }
                      detail={METRIC_DETAILS.timing}
                      tone={gainClass(gap)}
                    />
                    <MetricCell
                      label="Risk-adjusted"
                      term="Sharpe"
                      value={
                        m?.sharpe === null || m?.sharpe === undefined
                          ? "—"
                          : m.sharpe.toFixed(2)
                      }
                      insight={explainSharpe(m?.sharpe)}
                      detail={METRIC_DETAILS.sharpe}
                    />
                    <MetricCell
                      label="Volatility"
                      value={fmtPctAbs(m?.volatility)}
                      insight={explainVolatility(m?.volatility)}
                      detail={METRIC_DETAILS.volatility}
                    />
                    <MetricCell
                      label="Largest position"
                      value={
                        conc ? `${conc.topPct.toFixed(0)}% ${conc.topSymbol}` : "—"
                      }
                      insight={explainTopPosition(conc ? conc.topPct : null)}
                      detail={METRIC_DETAILS.topPosition}
                    />
                    <MetricCell
                      label="Diversification"
                      value={conc ? `~${conc.effectiveN.toFixed(1)} bets` : "—"}
                      insight={
                        conc
                          ? `your ${data.holdings.length} holdings act like ~${conc.effectiveN.toFixed(1)} independent bets`
                          : "add holdings to see this"
                      }
                      detail={METRIC_DETAILS.diversification}
                    />
                  </div>
                </TooltipProvider>
              );
            })()
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Holdings</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead
                    label="Asset"
                    sortKey="symbol"
                    sort={sort}
                    onSort={toggleSort}
                    align="left"
                    className="pl-6"
                  />
                  <SortableHead label="Qty" sortKey="quantity" sort={sort} onSort={toggleSort} />
                  <SortableHead label="Price" sortKey="price" sort={sort} onSort={toggleSort} />
                  <SortableHead label="Value" sortKey="marketValue" sort={sort} onSort={toggleSort} />
                  <SortableHead
                    label={windowed ? `P/L · ${windowLabel}` : "P/L"}
                    sortKey="pl"
                    sort={sort}
                    onSort={toggleSort}
                    className="pr-6"
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortHoldings(data.holdings, sort, windowed).map((h) => (
                  <TableRow key={h.assetId} className="group">
                    <TableCell className="pl-6">
                      <Link
                        href={`/positions/${h.assetId}`}
                        className="flex items-center gap-2.5"
                      >
                        <AssetLogo symbol={h.symbol} assetClass={h.class} size={24} />
                        <span className="font-medium group-hover:underline">
                          {h.symbol}
                        </span>
                        {h.name !== h.symbol && (
                          <span className="hidden truncate text-xs text-muted-foreground xl:inline">
                            {h.name}
                          </span>
                        )}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtQty(h.quantity)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtUsd(h.price)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {fmtUsd(h.marketValue)}
                    </TableCell>
                    <TableCell
                      className={`pr-6 text-right tabular-nums ${gainClass(
                        windowed ? h.periodGain : h.unrealizedGain,
                      )}`}
                    >
                      {fmtUsd(windowed ? h.periodGain : h.unrealizedGain)}
                      <span className="ml-1 text-xs">
                        ({fmtPct(windowed ? h.periodGainPct : h.unrealizedGainPct)})
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Allocation</CardTitle>
          </CardHeader>
          <CardContent>
            <AllocationDonut
              data={data.holdings
                .filter((h) => h.marketValue !== null)
                .map((h) => ({ symbol: h.symbol, value: h.marketValue! }))}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
