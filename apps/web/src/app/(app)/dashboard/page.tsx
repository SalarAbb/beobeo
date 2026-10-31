"use client";

import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Gauge } from "lucide-react";
import Link from "next/link";
import { AssetLogo } from "@/components/asset-logo";
import { usePortfolio } from "@/components/portfolio-context";
import { Section, StatStrip, StatTile } from "@/components/page-section";
import { AllocationSection } from "@/components/allocation-section";
import { NextBuySection } from "@/components/next-buy-section";
import { DividendIncomeSection } from "@/components/dividend-income-section";
import { ValueChart } from "@/components/charts/value-chart";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TabError } from "@/components/tax-center/tab-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TooltipProvider } from "@/components/ui/tooltip";
import { METRIC_LABEL_CLASS, MetricHover } from "@/components/metric-hover";
import { lastDeposit, nextBuyHoldings } from "@/lib/next-buy-defaults";
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

type SortKey = "symbol" | "quantity" | "price" | "marketValue" | "pl" | "plPct";
type SortState = { key: SortKey; dir: "asc" | "desc" };

interface SortableHolding {
  symbol: string;
  quantity: number;
  price: number | null;
  marketValue: number | null;
  unrealizedGain: number | null;
  unrealizedGainPct: number | null;
  periodGain: number | null;
  periodGainPct: number | null;
}

function sortHoldings<T extends SortableHolding>(
  holdings: T[],
  sort: SortState,
  windowed: boolean,
): T[] {
  const val = (h: SortableHolding): string | number | null =>
    sort.key === "pl"
      ? windowed
        ? h.periodGain
        : h.unrealizedGain
      : sort.key === "plPct"
        ? windowed
          ? h.periodGainPct
          : h.unrealizedGainPct
        : h[sort.key];
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

function SortButton({
  label,
  sortKey,
  sort,
  onSort,
  ariaLabel,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (k: SortKey) => void;
  ariaLabel?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1 text-xs hover:text-foreground ${
        active ? "text-foreground" : "text-muted-foreground"
      }`}
    >
      {label}
      <span aria-hidden className="w-2.5 text-[9px]">
        {active ? (sort.dir === "desc" ? "▼" : "▲") : ""}
      </span>
    </button>
  );
}

function SortableHead({
  className,
  align = "right",
  ...button
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (k: SortKey) => void;
  className?: string;
  align?: "left" | "right";
}) {
  return (
    <TableHead className={`${align === "right" ? "text-right" : ""} ${className ?? ""}`}>
      <SortButton {...button} />
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
    <MetricHover
      label={label}
      term={term}
      insight={insight}
      meaning={detail.meaning}
      yardstick={detail.yardstick}
      className="flex min-w-0 flex-col gap-1.5"
    >
      <span className={`self-start text-xs font-medium text-muted-foreground ${METRIC_LABEL_CLASS}`}>
        {label}
      </span>
      <span className={`figure text-xl ${tone ?? ""}`}>
        {value}
      </span>
    </MetricHover>
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

interface MetricValues {
  xirr: number | null;
  twr: number | null;
  twrAnnualized: number | null;
  behaviorGap: number | null;
  sharpe: number | null;
  volatility: number | null;
  from?: string | null;
}

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

/** Your money in dollars over the whole history, the bridge from the strip's
 *  tiles to the percentages below. */
interface MoneyBridge {
  value: number;
  /** Put in, minus sales: the value chart's dashed line. */
  invested: number;
  unrealized: number;
  realized: number;
  dividends: number;
}

/** What the numbers below cover and how they fit together. petyr (mission 38)
 *  had no dates; arya (mission 68) and gilderoy (mission 60) couldn't tie
 *  "+23.91% growth of your picks" to "+9.63%" on the strip. On the All window
 *  it starts from dollars (put in, worth now, the gain = the strip's tiles),
 *  then says what each percentage measures and why it differs. */
function PeriodNote({
  m,
  window,
  money,
}: {
  m: MetricValues | undefined;
  window?: string;
  money?: MoneyBridge;
}) {
  const fmt = (v: number) => `${v >= 0 ? "" : "−"}${Math.abs(v).toFixed(2)}%`;
  const fig = (s: string) => <span className="data text-foreground">{s}</span>;
  const gain = money ? money.value - money.invested + money.dividends : null;
  // Only meaningful while more went in than came out of sales.
  const gainPct =
    money && gain !== null && money.invested > 0 ? (gain / money.invested) * 100 : null;
  const twr = m?.twr ?? null;
  const perYear =
    m?.twrAnnualized != null && twr != null && twr !== m.twrAnnualized ? m.twrAnnualized : null;
  const since = m?.from ? fmtDay(m.from) : null;
  return (
    <div className="grid max-w-2xl gap-2 text-sm text-muted-foreground">
      {/* No end date: the series is keyed by the UTC day, which reads as
          tomorrow on a US evening. "through today" is true in every time zone. */}
      <p>
        {since ? (
          <>
            From {fig(since)} through today{window && <> ({window})</>}.{" "}
          </>
        ) : (
          window && <>Over {window}. </>
        )}
        {money && gain !== null && (
          <>
            In dollars: you put in {fig(fmtUsd(money.invested))}{" "}
            more than your sales took out, and it&apos;s worth {fig(fmtUsd(money.value))} now, {fig(fmtUsd(gain))}
            {gainPct !== null && <> ({fig(fmtPct(gainPct))} on your money)</>}. That&apos;s
            the {fig(fmtUsd(money.unrealized))} gain on holdings plus{" "}
            {fig(fmtUsd(money.realized))} from sales
            {money.dividends !== 0 && <> and {fig(fmtUsd(money.dividends))} of dividends</>}.
            The gain on holdings&apos; percentage only compares what you still own with
            what you paid for it.
          </>
        )}
      </p>
      <p>
        {twr !== null ? (
          <>
            Growth of your picks, {fig(fmtPct(twr))}
            {perYear !== null && <> (about {fig(fmt(perYear))} a year)</>}, is what a dollar
            put in {since ? <>on {since}</> : "at the start"} and left alone would have
            become
            {gainPct !== null && Math.abs(twr - gainPct) >= 0.5 && (
              <>
                . Your money did {twr > gainPct ? "less" : "better"} than that dollar because
                of when it went in: more of it was invested during the{" "}
                {twr > gainPct ? "weaker" : "stronger"} stretches
              </>
            )}
            .{" "}
          </>
        ) : (
          <>The growth of your picks ignores when each dollar went in. </>
        )}
        The yearly rate{m?.xirr != null && <>, {fig(fmtPct(m.xirr))},</>}{" "}
        is your money&apos;s own gain as a rate per year, counting how long each dollar was in. The timing effect
        is the yearly rate minus the growth of your picks per year. Swings and reward for
        risk cover the same dates. Hover or tap any label for what it means.
      </p>
    </div>
  );
}

/** The expert numbers behind "Performance details" (R-002: one deliberate
 *  tap away, plain labels, the technical term only in the hover card). */
function MetricsGrid({
  m,
  holdings,
}: {
  m: MetricValues | undefined;
  holdings: HoldingWeight[];
}) {
  const conc = concentration(holdings);
  const gap = m?.behaviorGap ?? null;
  return (
    <TooltipProvider delayDuration={150}>
      <div className="grid grid-cols-2 gap-x-8 gap-y-7 lg:grid-cols-4">
        <MetricCell
          label="Yearly rate"
          term="XIRR"
          value={fmtPct(m?.xirr)}
          insight="what your money actually earns per year"
          detail={METRIC_DETAILS.xirr}
          tone={gainClass(m?.xirr)}
        />
        <MetricCell
          label="Growth of your picks"
          term="TWR"
          value={fmtPct(m?.twr)}
          insight={explainTwr(m?.twr)}
          detail={METRIC_DETAILS.twr}
          tone={gainClass(m?.twr)}
        />
        <MetricCell
          label="Timing effect"
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
          label="Reward for risk"
          term="Sharpe"
          value={m?.sharpe === null || m?.sharpe === undefined ? "—" : m.sharpe.toFixed(2)}
          insight={explainSharpe(m?.sharpe)}
          detail={METRIC_DETAILS.sharpe}
        />
        <MetricCell
          label="Swings"
          term="volatility"
          value={fmtPctAbs(m?.volatility)}
          insight={explainVolatility(m?.volatility)}
          detail={METRIC_DETAILS.volatility}
        />
        <MetricCell
          label="Largest position"
          value={conc ? `${conc.topPct.toFixed(0)}% ${conc.topSymbol}` : "—"}
          insight={explainTopPosition(conc ? conc.topPct : null)}
          detail={METRIC_DETAILS.topPosition}
        />
        <MetricCell
          label="Spread"
          term="diversification"
          value={conc ? `~${conc.effectiveN.toFixed(1)} bets` : "—"}
          insight={
            conc
              ? `your ${holdings.length} holdings act like ~${conc.effectiveN.toFixed(1)} independent bets`
              : "add holdings to see this"
          }
          detail={METRIC_DETAILS.diversification}
        />
      </div>
    </TooltipProvider>
  );
}

export default function DashboardPage() {
  const trpc = useTRPC();
  const { portfolioId, activeName } = usePortfolio();
  const [pnlWindow, setPnlWindow] = useState<PnlWindow>("all");
  const [sort, setSort] = useState<SortState>({ key: "marketValue", dir: "desc" });
  // R-002: expert metrics sit one deliberate tap away, never on the first screen.
  const [showDetails, setShowDetails] = useState(false);
  const scope = { portfolioId: portfolioId ?? undefined };
  const queryClient = useQueryClient();
  const prefetchPosition = (assetId: string) =>
    void queryClient.prefetchQuery(trpc.portfolio.position.queryOptions({ assetId, ...scope }));
  // Keep showing the previous window's data while the new one loads, but
  // never another portfolio's: that put Main's numbers under "Kid Custodial"
  // for a moment after a switch (hermione, portfolios.manage mission 32).
  const samePortfolio = <T,>(
    prev: T | undefined,
    prevQuery: { queryKey: readonly unknown[] } | undefined,
  ): T | undefined => {
    const input = (prevQuery?.queryKey[1] as { input?: { portfolioId?: string } } | undefined)
      ?.input;
    return input?.portfolioId === scope.portfolioId ? keepPreviousData(prev) : undefined;
  };
  const overview = useQuery({
    ...trpc.portfolio.overview.queryOptions({ ...scope, window: pnlWindow }),
    placeholderData: samePortfolio,
  });
  const timeseries = useQuery(trpc.portfolio.timeseries.queryOptions(scope));
  const metrics = useQuery({
    ...trpc.portfolio.metrics.queryOptions({ ...scope, window: pnlWindow }),
    placeholderData: samePortfolio,
  });

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
  // A failed load must never read as "No holdings yet": that looks like lost data.
  if (!data && overview.isError) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl">Dashboard</h1>
        <div className="mt-6">
          <TabError what="your portfolio" onRetry={() => void overview.refetch()} />
        </div>
      </div>
    );
  }
  if (!data || data.holdings.length === 0) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl">Dashboard</h1>
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
  // Labels follow the window the numbers on screen were computed for, not
  // the tapped one: while 1M loaded, 1W's figures sat under "Change · 1M"
  // and read as the same window changing (gilderoy, dashboard.window mission 60).
  const windowed = data.window !== "all";
  const windowLabel = WINDOWS.find((w) => w.value === data.window)!.label;
  const loadingLabel = overview.isPlaceholderData
    ? WINDOWS.find((w) => w.value === pnlWindow)!.label
    : null;
  const stale = loadingLabel ? "opacity-50 transition-opacity" : "transition-opacity";

  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-12">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-3xl">Dashboard</h1>
        <span className="text-sm text-muted-foreground">{activeName}</span>
        <div className="ml-auto">
          <SegmentedControl value={pnlWindow} onChange={setPnlWindow} options={WINDOWS} />
        </div>
        {loadingLabel && (
          <p role="status" className="basis-full text-right text-xs text-muted-foreground">
            Working out {loadingLabel}… showing {windowLabel} until it&apos;s in.
          </p>
        )}
      </div>

      {data.dataIssues.length > 0 && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-muted-foreground">
          Some assets have inconsistent history and are excluded:{" "}
          {data.dataIssues.map((i) => i.symbol).join(", ")}. Check their
          transactions (a sell may exceed recorded buys).
        </p>
      )}

      <StatStrip className={`-mt-6 ${stale}`}>
        <StatTile
          label="Portfolio value"
          value={fmtUsd(totals.value)}
          // "I put in $X, it's worth $Y" is the first thing people check (samwell).
          // Cost of what you hold, so value − this = Gain on holdings next to it.
          sub={`You paid ${fmtUsd(totals.cost)}`}
          subTone="text-muted-foreground"
        />
        {windowed ? (
          <StatTile
            label={`Change · ${windowLabel}`}
            value={fmtUsd(totals.periodGain)}
            sub={fmtPct(totals.periodGainPct)}
            tone={gainClass(totals.periodGain)}
          />
        ) : (
          <StatTile
            label="Gain on holdings"
            value={fmtUsd(totals.unrealized)}
            sub={fmtPct(totals.unrealizedPct)}
            tone={gainClass(totals.unrealized)}
          />
        )}
        <StatTile
          label={windowed ? `Gain from sales · ${windowLabel}` : "Gain from sales"}
          value={fmtUsd(totals.realized)}
          tone={gainClass(totals.realized)}
          // All time on its own reads as "this year" next to the Tax Center
          // and chat (personas asked which one to put on their taxes).
          sub={windowed ? undefined : `All time · ${fmtUsd(totals.realizedThisYear)} this year`}
          subTone="text-muted-foreground"
        />
        <StatTile
          label={windowed ? `Dividends · ${windowLabel}` : "Dividends"}
          value={fmtUsd(totals.dividends)}
          // A bare $0 next to dividend payers read as "not tracking them"
          // (olenna): say none are recorded and where to add one.
          sub={
            totals.dividends !== 0 ? undefined : windowed ? (
              "None recorded in this period"
            ) : (
              <>
                None recorded ·{" "}
                <Link href="/transactions?add=dividend" className="underline underline-offset-2">
                  add a payout
                </Link>
              </>
            )
          }
          subTone="text-muted-foreground"
        />
      </StatStrip>

      <Section title="Portfolio over time">
        {timeseries.isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : timeseries.isError && !timeseries.data ? (
          <TabError what="the chart" onRetry={() => void timeseries.refetch()} />
        ) : (
          <ValueChart data={timeseries.data ?? []} liveValue={totals.value} />
        )}
      </Section>

      <div className="-mt-6 grid gap-6">
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          aria-expanded={showDetails}
          aria-controls="performance-details"
          className="inline-flex items-center gap-2 justify-self-start rounded-full border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-accent hover:text-primary aria-expanded:border-transparent aria-expanded:bg-accent aria-expanded:text-primary"
        >
          <Gauge aria-hidden className="size-4 text-primary" />
          Performance details
          <ChevronDown
            aria-hidden
            className={`size-4 transition-transform ${showDetails ? "rotate-180" : ""}`}
          />
        </button>
        {showDetails && (
          <div id="performance-details" className="grid gap-6">
            <PeriodNote
              m={metrics.data}
              window={
                metrics.data && metrics.data.window !== "all"
                  ? WINDOWS.find((w) => w.value === metrics.data!.window)!.label
                  : undefined
              }
              money={
                metrics.data?.window === "all" && !windowed && timeseries.data?.length
                  ? {
                      value: totals.value,
                      invested: timeseries.data[timeseries.data.length - 1]!.invested,
                      unrealized: totals.unrealized,
                      realized: totals.realized,
                      dividends: totals.dividends,
                    }
                  : undefined
              }
            />
            {metrics.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : metrics.isError && !metrics.data ? (
              <TabError what="these numbers" onRetry={() => void metrics.refetch()} />
            ) : (
              <MetricsGrid m={metrics.data} holdings={data.holdings} />
            )}
          </div>
        )}
      </div>

      <Section title="Holdings">
            <Table className={stale}>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortableHead
                    label="Asset"
                    sortKey="symbol"
                    sort={sort}
                    onSort={toggleSort}
                    align="left"
                    className="pl-1"
                  />
                  <SortableHead
                    label="Qty"
                    sortKey="quantity"
                    sort={sort}
                    onSort={toggleSort}
                    className="hidden sm:table-cell"
                  />
                  <SortableHead
                    label="Price"
                    sortKey="price"
                    sort={sort}
                    onSort={toggleSort}
                    className="hidden sm:table-cell"
                  />
                  <SortableHead label="Value" sortKey="marketValue" sort={sort} onSort={toggleSort} />
                  {/* The cell shows dollars and percent, so either can order the
                      list: a small holding up 37% sorted under a big one up 5%. */}
                  <TableHead className="pr-1 text-right">
                    <span className="inline-flex items-center gap-2">
                      <SortButton
                        label={windowed ? `Change · ${windowLabel}` : "Gain"}
                        sortKey="pl"
                        sort={sort}
                        onSort={toggleSort}
                        ariaLabel={`Sort by ${windowed ? "change" : "gain"} in dollars`}
                      />
                      <SortButton
                        label="%"
                        sortKey="plPct"
                        sort={sort}
                        onSort={toggleSort}
                        ariaLabel={`Sort by ${windowed ? "change" : "gain"} in percent`}
                      />
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortHoldings(data.holdings, sort, windowed).map((h) => (
                  <TableRow key={h.assetId} className="group">
                    <TableCell className="pl-1">
                      <Link
                        href={`/positions/${h.assetId}`}
                        className="flex items-center gap-2.5"
                        // The position page replays the asset's history; start it on the way to the click.
                        onPointerEnter={() => prefetchPosition(h.assetId)}
                        onFocus={() => prefetchPosition(h.assetId)}
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
                    <TableCell className="hidden text-right data text-[13px] sm:table-cell">
                      {fmtQty(h.quantity)}
                    </TableCell>
                    <TableCell className="hidden text-right data text-[13px] sm:table-cell">
                      {fmtUsd(h.price)}
                    </TableCell>
                    <TableCell className="data text-right text-[13px] font-medium">
                      {fmtUsd(h.marketValue)}
                    </TableCell>
                    <TableCell
                      className={`pr-1 text-right data text-[13px] ${gainClass(
                        windowed ? h.periodGain : h.unrealizedGain,
                      )}`}
                    >
                      {fmtUsd(windowed ? h.periodGain : h.unrealizedGain)}
                      <span className="ml-1 block text-[11px] sm:inline">
                        {fmtPct(windowed ? h.periodGainPct : h.unrealizedGainPct)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
      </Section>

      <AllocationSection
        holdings={data.holdings
          .filter((h) => h.marketValue !== null)
          .map((h) => ({ symbol: h.symbol, value: h.marketValue! }))}
        lastDeposit={lastDeposit(timeseries.data)}
      />

      <DividendIncomeSection holdings={data.holdings} />

      {/* Asked once, with the real last deposit: a $500 placeholder asked first
          meant two next-buy requests on every cold dashboard. */}
      <NextBuySection
        holdings={nextBuyHoldings(data.holdings).map((h) => ({
          id: h.assetId,
          symbol: h.symbol,
          name: h.name,
          class: h.class,
        }))}
        lastDeposit={timeseries.isPending ? undefined : lastDeposit(timeseries.data)}
      />
    </div>
  );
}
