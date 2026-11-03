"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { AssetLogo } from "@/components/asset-logo";
import { METRIC_LABEL_CLASS, MetricHover } from "@/components/metric-hover";
import { Section, StatStrip, StatTile } from "@/components/page-section";
import { usePortfolio } from "@/components/portfolio-context";
import { Button } from "@/components/ui/button";
import { TabError, TabLoading } from "@/components/tax-center/tab-state";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { fmtQty, fmtUsd, gainClass } from "@/lib/viz";
import type { AppRouter } from "@/server/routers";
import { LossBreakdownBar } from "./loss-breakdown-bar";
import { useIncome } from "./use-income";

type Now = inferRouterOutputs<AppRouter>["tax"]["now"];
type Move = Now["moves"][number];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "2026-11-27" → "Nov 27" */
const day = (iso: string | null | undefined) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : "";

/**
 * The 30-day rule in plain words, with its name in a tap card (R-002): "(wash-sale
 * rule)" in a row read as homework to a beginner (luna: "'Wash-sale rule' and
 * 'then saves ~$1' make no sense to me"), while an expert can still reach the term.
 */
function ThirtyDayRule({ children, insight }: { children: ReactNode; insight: string }) {
  return (
    <MetricHover
      label="The 30-day rule"
      term="wash-sale rule"
      insight={insight}
      meaning="Buy the same stock or fund within 30 days before or after selling it at a loss, and the loss doesn't count yet: it's added to the new shares' cost instead. Crypto isn't covered."
      className={METRIC_LABEL_CLASS}
    >
      {children}
    </MetricHover>
  );
}

/** What to do on one line, and why in a muted line under it. */
function MoveText({ move: m }: { move: Move }) {
  const symbol = (
    <Link href={`/positions/${m.assetId}`} className="font-medium hover:underline">
      {m.symbol}
    </Link>
  );
  let action: ReactNode;
  let why: ReactNode;
  switch (m.kind) {
    case "lock":
      action = (
        <>
          Sell and buy back <span className="data">{fmtQty(m.quantity ?? 0)}</span> {symbol}
        </>
      );
      why = (
        <>
          books a <span className="data">{fmtUsd(m.lossUsd, 0)}</span>{" "}loss, same coins after ·{" "}
          {m.accounts?.join(", ")}
        </>
      );
      break;
    case "harvest":
      action = (
        <>
          Sell <span className="data">{fmtQty(m.quantity ?? 0)}</span> {symbol}
        </>
      );
      why = (
        <>
          books a <span className="data">{fmtUsd(m.lossUsd, 0)}</span>{" "}loss · don&apos;t buy it
          back before <span className="data">{day(m.rebuyAfter)}</span>,{" "}
          <ThirtyDayRule
            insight={`Buy ${m.symbol} back on ${day(m.rebuyAfter)} or later and the ${fmtUsd(m.lossUsd, 0)} loss counts this year.`}
          >
            or the loss won&apos;t count
          </ThirtyDayRule>
        </>
      );
      break;
    case "on_hold":
      action = (
        <>
          Don&apos;t sell {symbol} before <span className="data">{day(m.clearsOn)}</span>
        </>
      );
      why = m.permanentlyDisallowed ? (
        <>
          a retirement account bought it recently; selling sooner loses the{" "}
          <span className="data">{fmtUsd(m.lossUsd, 0)}</span>{" "}loss for good
        </>
      ) : (
        <>
          you bought more in the last 30 days, so its{" "}
          <span className="data">{fmtUsd(m.lossUsd, 0)}</span>{" "}loss{" "}
          <ThirtyDayRule
            insight={`Sell on ${day(m.clearsOn)} or later and the ${fmtUsd(m.lossUsd, 0)} loss counts.`}
          >
            wouldn&apos;t count yet
          </ThirtyDayRule>
          ; buying more pushes the date out
        </>
      );
      break;
    case "wait":
      action = (
        <>
          Hold {(m.lots ?? 1) > 1 && <>{plural(m.lots ?? 1, "purchase")} of </>}
          {symbol} until <span className="data">{day(m.firstLongTermOn)}</span>
          {m.lastLongTermOn !== m.firstLongTermOn && (
            <>
              –<span className="data">{day(m.lastLongTermOn)}</span>
            </>
          )}
        </>
      );
      why = "then the gain is taxed at the lower long-term rate";
      break;
    case "zero_gain":
      action = (
        <>
          Sell and buy back <span className="data">{fmtQty(m.quantity ?? 0)}</span> {symbol}
        </>
      );
      why = (
        <>
          takes a <span className="data">{fmtUsd(m.gainUsd ?? 0, 0)}</span>{" "}gain at 0% and
          raises your cost, so a later sale owes less · {m.accounts?.join(", ")}
        </>
      );
      break;
  }
  return (
    <div className="min-w-0">
      <div>{action}</div>
      <div className="text-xs text-muted-foreground sm:truncate">{why}</div>
    </div>
  );
}

/** "2026-11-27" → "Nov 27, 2026" */
const fullDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

/**
 * The purchases behind a "Hold…" or "Don't sell…" row, each with its exact
 * long-term date, closed by default (petyr: "'Hold 2 purchases of VTI until
 * Nov 5–Dec 5' is a date range, not an answer. I want lot, shares, basis,
 * gain and the exact date each one flips to long-term").
 */
function MovePurchases({ move: m }: { move: Move }) {
  const purchases = "purchases" in m ? (m.purchases ?? []) : [];
  if (purchases.length === 0) return null;
  return (
    <details className="ml-[34px] text-sm">
      <summary className="w-fit cursor-pointer text-xs text-primary marker:text-muted-foreground">
        {purchases.length === 1 ? (
          "Show the purchase"
        ) : (
          <>
            Show the <span className="data">{purchases.length}</span> purchases
          </>
        )}
      </summary>
      <ul className="mt-1.5 grid divide-y border-y">
        {purchases.map((p, i) => (
          <li
            key={`${p.boughtOn}-${p.accountName}-${i}`}
            className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-0.5 py-1.5"
          >
            <span>
              Bought <span className="data">{fullDay(p.boughtOn)}</span>{" "}
              <span className="text-muted-foreground">in {p.accountName}</span>
            </span>
            <span className={cn("data text-right", gainClass(p.gainUsd))}>
              {fmtUsd(p.gainUsd)}
            </span>
            <span className="data text-xs text-muted-foreground">
              {fmtQty(p.quantity)} {p.quantity === 1 ? "unit" : "units"} · paid{" "}
              {fmtUsd(p.costUsd)}
            </span>
            {/* Its own line on phones, where beside the units it squeezed the
                purchase into a narrow column. */}
            <span className="col-span-2 text-xs text-muted-foreground sm:col-span-1 sm:text-right">
              {p.isLongTerm ? (
                "held over a year"
              ) : (
                <>
                  long-term from <span className="data">{fullDay(p.longTermOn)}</span>
                </>
              )}
              {p.savedUsd !== null && p.savedUsd >= 0.5 && (
                <>
                  {" "}
                  · waiting saves <span className="data">~{fmtUsd(p.savedUsd, 0)}</span>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * How a loss move's "saves ~$X" is worked out: each part of the loss, where
 * it lands (cancels gains taxed at their rate, comes off your pay, carries to
 * next year) and what that part saves. Core's landing × the rates used is the
 * saving exactly (barristan: "saves about $442 on a $2,948 loss. I don't see
 * how it gets that number"; hermione wanted the rate applied, to check it).
 */
function SavingMath({
  move: m,
  rates,
  stacked,
  children,
}: {
  move: Move;
  rates: Now["ratesUsed"];
  /** Other loss moves are counted before or after this one. */
  stacked: boolean;
  children: ReactNode;
}) {
  const l = "landing" in m ? m.landing : null;
  if (!l || m.taxSavedUsd === null) return <>{children}</>;
  const st = rates.shortTermPct;
  const later = (st * rates.carryforwardCountsPct) / 100;
  const parts = [
    {
      usd: l.cancelsShortTermGainsUsd,
      what: <>cancels gains on things held a year or less, taxed at {pct(st)}</>,
      rate: st,
    },
    {
      usd: l.cancelsLongTermGainsUsd,
      what: <>cancels gains on things held over a year, taxed at {pct(rates.longTermPct)}</>,
      rate: rates.longTermPct,
    },
    {
      usd: l.offIncomeUsd,
      what: <>comes off your pay (up to $3,000 a year), taxed at {pct(st)}</>,
      rate: st,
    },
    {
      usd: l.carriedForwardUsd,
      what: (
        <>
          carries to next year; it&apos;s only used later, so it counts as{" "}
          {pct(rates.carryforwardCountsPct)} of {pct(st)} = {pct(later)}
        </>
      ),
      rate: later,
    },
  ].filter((p) => p.usd >= 0.5);
  const when = m.kind === "on_hold" ? `Sold on ${day(m.clearsOn)}, the` : "The";

  return (
    <MetricHover
      label={`How ~${fmtUsd(m.taxSavedUsd, 0)} is worked out`}
      insight={`${when} ${fmtUsd(m.lossUsd, 0)} loss saves about ${fmtUsd(m.taxSavedUsd, 0)} in tax.`}
      meaning={
        <>
          <ul className="grid gap-1">
            {parts.map((p, i) => (
              <li key={i}>
                <span className="data text-foreground">{fmtUsd(p.usd, 0)}</span> {p.what}:{" "}
                <span className="data text-foreground">{fmtUsd((p.usd * p.rate) / 100, 0)}</span>
              </li>
            ))}
          </ul>
          {stacked && (
            <p className="mt-1.5">
              Each move is counted on top of the ones before it (crypto first, then other
              sales, then the ones on hold), so no gain is cancelled twice.
            </p>
          )}
        </>
      }
      yardstick="Your Tax Profile rates · today's prices"
      align="end"
      className={METRIC_LABEL_CLASS}
    >
      {children}
    </MetricHover>
  );
}

/**
 * Ties the year's totals to the sales they add up from, and to the
 * Dashboard's all-time "Gain from sales" tile: personas read that tile as
 * their tax number and called this page wrong (barristan: "$11,589 here but I
 * was told $23,857", `tax-center-realized-gains-mismatch`).
 */
function SalesBehindTotals({ data: d }: { data: Now }) {
  const sales = d.ytdSales;
  const allTime = d.dashboardRealized?.allTime ?? null;
  const salesSum = sales.reduce((s, x) => s + x.shortTermGain + x.longTermGain, 0);
  const iraGain = d.ytdTaxAdvantagedGain;
  const showsAllTime = allTime !== null && Math.abs(allTime - salesSum) >= 1;
  const showsIra = Math.abs(iraGain) >= 1;
  if (sales.length === 0 && !showsAllTime) return null;
  const earlier = allTime === null ? 0 : allTime - salesSum - iraGain;
  const bridge = [
    ...(sales.length > 0 ? [{ label: `this year (the two gains above)`, usd: salesSum }] : []),
    ...(showsIra ? [{ label: "this year in retirement accounts (not taxed)", usd: iraGain }] : []),
    ...(Math.abs(earlier) >= 1 ? [{ label: "in earlier years", usd: earlier }] : []),
  ];

  return (
    <div className="grid gap-2 text-sm">
      <p className="max-w-2xl text-muted-foreground">
        {sales.length > 0 ? (
          <>
            Your {d.taxYear} totals add up{" "}
            <span className="data">{plural(sales.length, "sale")}</span> from taxable accounts
            {d.ytdOverridden && ", unless you typed your own totals in Tax Profile"}.
          </>
        ) : (
          <>You haven&apos;t sold anything in a taxable account in {d.taxYear}.</>
        )}
        {showsAllTime && (
          <>
            {" "}
            {/* Spelled out as a sum of parts this page shows, because the
                Dashboard's figure isn't on this page: "counts every year"
                named a $12,510 the user couldn't find anywhere here. */}
            The Dashboard&apos;s Gain from sales is all-time:{" "}
            {bridge.map((part, i) => (
              <Fragment key={part.label}>
                {i > 0 && " + "}
                <span className="data">{fmtUsd(part.usd, 0)}</span> {part.label}
              </Fragment>
            ))}{" "}
            = <span className="data">{fmtUsd(allTime, 0)}</span>. Only this year&apos;s sales in
            taxable accounts are taxed this year.
          </>
        )}
      </p>
      {sales.length > 0 && (
        <details className="group">
          <summary className="w-fit cursor-pointer text-primary marker:text-muted-foreground">
            Show the{" "}
            {sales.length === 1 ? (
              "sale"
            ) : (
              <>
                <span className="data">{sales.length}</span> sales
              </>
            )}{" "}
            behind these totals
          </summary>
          <ul className="mt-2 grid divide-y border-y">
            {sales.map((s) => {
              const gain = s.shortTermGain + s.longTermGain;
              const mixed = Math.abs(s.shortTermGain) >= 0.005 && Math.abs(s.longTermGain) >= 0.005;
              return (
                <li
                  key={s.txnId}
                  className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-0.5 py-2"
                >
                  <span>
                    <span className="font-medium">{s.symbol}</span>{" "}
                    <span className="text-muted-foreground">
                      sold <span className="data">{s.soldAt}</span>
                    </span>
                  </span>
                  <span className={cn("data text-right", gainClass(gain))}>{fmtUsd(gain)}</span>
                  <span className="data text-xs text-muted-foreground">
                    {fmtQty(s.quantity)} in {s.accountName} · {fmtUsd(s.proceeds)}
                  </span>
                  <span className="data text-right text-xs text-muted-foreground">
                    {mixed
                      ? `${fmtUsd(s.shortTermGain, 0)} short · ${fmtUsd(s.longTermGain, 0)} long`
                      : Math.abs(s.longTermGain) >= 0.005
                        ? "long-term"
                        : "short-term"}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {showsAllTime && d.allSales.length > 0 && (
        <AllTimeSales sales={d.allSales} dashboardTotal={allTime} />
      )}
    </div>
  );
}

/**
 * Every year's sales, retirement accounts included, grouped by year: the
 * rows the Dashboard's all-time "Gain from sales" adds up from. Petyr
 * (mission 104) read "counts every year" and still couldn't tie his −$1,523
 * to anything: "Show me the sales that add up to that number."
 */
function AllTimeSales({ sales, dashboardTotal }: { sales: Now["allSales"]; dashboardTotal: number }) {
  const gainOf = (s: Now["allSales"][number]) => s.shortTermGain + s.longTermGain;
  const years = new Map<string, Now["allSales"]>();
  for (const s of sales) {
    const y = s.soldAt.slice(0, 4);
    years.set(y, [...(years.get(y) ?? []), s]);
  }
  const total = sales.reduce((s, x) => s + gainOf(x), 0);
  return (
    <details className="group">
      <summary className="w-fit cursor-pointer text-primary marker:text-muted-foreground">
        Show {sales.length === 1 ? "the sale" : <>all <span className="data">{sales.length}</span> sales</>}
        {Math.abs(total - dashboardTotal) < 1 ? (
          <>
            {" "}
            behind the Dashboard&apos;s <span className="data">{fmtUsd(dashboardTotal, 0)}</span>
          </>
        ) : (
          ", every year"
        )}
      </summary>
      <div className="mt-2 grid gap-3">
        {[...years].reverse().map(([year, rows]) => {
          const sum = rows.reduce((s, x) => s + gainOf(x), 0);
          return (
            <div key={year} className="grid gap-1">
              <p className="flex items-baseline justify-between gap-4 border-b pb-1">
                <span className="font-medium">
                  {year} <span className="font-normal text-muted-foreground">· {plural(rows.length, "sale")}</span>
                </span>
                <span className={cn("data", gainClass(sum))}>{fmtUsd(sum)}</span>
              </p>
              <ul className="grid divide-y">
                {rows.map((s) => {
                  const gain = gainOf(s);
                  const mixed =
                    Math.abs(s.shortTermGain) >= 0.005 && Math.abs(s.longTermGain) >= 0.005;
                  return (
                    <li
                      key={s.txnId}
                      className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-0.5 py-1.5"
                    >
                      <span>
                        <span className="font-medium">{s.symbol}</span>{" "}
                        <span className="text-muted-foreground">
                          sold <span className="data">{s.soldAt}</span>
                        </span>
                      </span>
                      <span className={cn("data text-right", gainClass(gain))}>{fmtUsd(gain)}</span>
                      <span className="data text-xs text-muted-foreground">
                        {fmtQty(s.quantity)} in {s.accountName} · sold for {fmtUsd(s.proceeds)}, paid{" "}
                        {fmtUsd(s.proceeds - gain)}
                      </span>
                      <span className="data text-right text-xs text-muted-foreground">
                        {!s.taxed
                          ? "retirement account, not taxed"
                          : mixed
                            ? `${fmtUsd(s.shortTermGain, 0)} short · ${fmtUsd(s.longTermGain, 0)} long`
                            : Math.abs(s.longTermGain) >= 0.005
                              ? "long-term"
                              : "short-term"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {years.size > 1 && (
          <p className="flex items-baseline justify-between gap-4 border-t pt-1 font-medium">
            <span>All years together</span>
            <span className={cn("data", gainClass(total))}>{fmtUsd(total)}</span>
          </p>
        )}
      </div>
    </details>
  );
}

const list = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

const pct = (n: number) => `${Math.round(n * 10) / 10}%`;

const taxNote = (t: number) =>
  t >= 0.5 ? `about ${fmtUsd(t, 0)} in tax` : t <= -0.5 ? `cuts tax by ${fmtUsd(-t, 0)}` : "no tax";

/**
 * The sell-everything estimate one holding at a time (fred: "Show me BTC,
 * ETH and SOL each with proceeds, basis, gain and tax"). Proceeds, cost and
 * gain add up to the total; each tax is for selling only that holding (the
 * position page's figure), so the note says why they needn't sum.
 */
function SellAllByHolding({
  rows,
  total,
  ytdGain,
  ytdLoss,
}: {
  rows: Now["sellAllByAsset"][string][];
  total: NonNullable<Now["sellAll"]>;
  ytdGain: number;
  ytdLoss: number;
}) {
  if (rows.length < 2) return null;
  const sorted = [...rows].sort((a, b) => b.proceedsUsd - a.proceedsUsd);
  const gainOf = (r: (typeof rows)[number]) => r.shortTermGainUsd + r.longTermGainUsd;
  const totalGain = total.shortTermGainUsd + total.longTermGainUsd;
  const aloneSum = rows.reduce((t, r) => t + r.taxUsd, 0);
  return (
    <details className="max-w-2xl text-sm">
      <summary className="w-fit cursor-pointer text-primary marker:text-muted-foreground">
        Show it by holding
      </summary>
      <ul className="mt-2 grid divide-y border-y">
        {sorted.map((r) => {
          const g = gainOf(r);
          const both = Math.abs(r.shortTermGainUsd) >= 0.5 && Math.abs(r.longTermGainUsd) >= 0.5;
          return (
            <li
              key={r.symbol}
              className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-0.5 py-1.5"
            >
              <span className="flex items-center gap-2">
                <AssetLogo symbol={r.symbol} assetClass={r.assetClass} size={18} />
                <span className="font-medium">{r.symbol}</span>
                <span className="data text-xs text-muted-foreground">
                  {fmtQty(r.units)} in {list(r.accounts)}
                </span>
              </span>
              <span className={cn("data text-right", gainClass(g))}>{fmtUsd(g)}</span>
              <span className="data text-xs text-muted-foreground">
                sells for {fmtUsd(r.proceedsUsd)}, paid {fmtUsd(r.costBasisUsd)}
                {" · "}
                {both
                  ? `${fmtUsd(r.shortTermGainUsd)} held a year or less, ${fmtUsd(r.longTermGainUsd)} longer`
                  : Math.abs(r.longTermGainUsd) >= 0.005
                    ? "all held over a year"
                    : "all held a year or less"}
                {r.disallowedLossUsd >= 1 && ` · ${fmtUsd(r.disallowedLossUsd, 0)} loss left out`}
              </span>
              <span className="data text-right text-xs text-muted-foreground">
                {taxNote(r.taxUsd)} if sold alone
              </span>
            </li>
          );
        })}
        <li className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-0.5 py-1.5 font-medium">
          <span>Together</span>
          <span className={cn("data text-right", gainClass(totalGain))}>{fmtUsd(totalGain)}</span>
          <span className="data text-xs font-normal text-muted-foreground">
            sells for {fmtUsd(total.proceedsUsd)}, paid {fmtUsd(total.costBasisUsd)}
          </span>
          <span className="data text-right text-xs font-normal text-muted-foreground">
            {taxNote(total.taxUsd)}
          </span>
        </li>
      </ul>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Each holding&apos;s tax is for selling only that one
        {ytdLoss > 0 ? (
          <>
            , after this year&apos;s <span className="data">{fmtUsd(ytdLoss, 0)}</span> net loss from
            sales
          </>
        ) : ytdGain > 0 ? (
          <>
            , on top of this year&apos;s <span className="data">{fmtUsd(ytdGain, 0)}</span> net gain
            from sales
          </>
        ) : null}
        .
        {Math.abs(aloneSum - total.taxUsd) >= 1 &&
          ` Sold together, one holding's loss cancels another's gain${ytdLoss > 0 ? " and this year's loss counts only once" : ""}, so the total isn't their sum.`}
      </p>
    </details>
  );
}

/**
 * "Roughly what would I owe if I sold?" (samwell, mission 51: the page only
 * said he owed nothing, and nothing moved when he saved his rates or a
 * carryforward). Every taxable purchase sold today, on top of the year so
 * far; retirement accounts are named as left out.
 */
function SellAllSection({
  sellAll: s,
  byAsset,
  ytdNet,
  onProfile,
}: {
  sellAll: NonNullable<Now["sellAll"]>;
  byAsset: Now["sellAllByAsset"];
  ytdNet: number;
  onProfile: () => void;
}) {
  const gain = s.shortTermGainUsd + s.longTermGainUsd;
  // This year's sales already in the total (fred: "how much of the zero tax
  // comes from the $2,567 already banked this year?").
  const ytdLoss = ytdNet <= -0.5 ? -ytdNet : 0;
  const ytdGain = ytdNet >= 0.5 ? ytdNet : 0;
  const both = Math.abs(s.shortTermGainUsd) >= 0.5 && Math.abs(s.longTermGainUsd) >= 0.5;
  const terms = both ? (
    <>
      {" "}
      (<span className="data">{fmtUsd(s.shortTermGainUsd, 0)}</span> held a year or less,{" "}
      <span className="data">{fmtUsd(s.longTermGainUsd, 0)}</span> longer)
    </>
  ) : null;
  const owes = s.taxUsd >= 0.5;
  const cuts = s.taxUsd <= -0.5;
  const rateNote = both
    ?`${pct(s.ordinaryRatePct)} on short-term gains, ${pct(s.ltcgRatePct)} on long-term`
      : Math.abs(s.shortTermGainUsd) >= 0.5
        ? `${pct(s.ordinaryRatePct)} on short-term gains`
        : `${pct(s.ltcgRatePct)} on long-term gains`;

  return (
    <Section title="If you sold everything today">
      <p className="-mt-2 max-w-2xl text-sm">
        Selling everything in {list(s.accounts)} would bring in{" "}
        <span className="data">{fmtUsd(s.proceedsUsd, 0)}</span>
        {gain >= 0.5 ? (
          <>
            {" "}
            for a <span className="data">{fmtUsd(gain, 0)}</span> gain{terms}.{" "}
            {owes ? (
              <>
                That&apos;s about <span className="data font-semibold">{fmtUsd(s.taxUsd, 0)}</span>{" "}
                in tax ({rateNote}
                {ytdLoss > 0 && (
                  <>
                    , after this year&apos;s <span className="data">{fmtUsd(ytdLoss, 0)}</span> net
                    loss from sales cancels <span className="data">{fmtUsd(Math.min(ytdLoss, gain), 0)}</span>{" "}
                    of the gain
                  </>
                )}
                ), leaving you <span className="data">{fmtUsd(s.proceedsUsd - s.taxUsd, 0)}</span>.
              </>
            ) : ytdLoss >= gain - 0.5 ? (
              <>
                It wouldn&apos;t add any tax: this year&apos;s sales so far are a{" "}
                <span className="data">{fmtUsd(ytdLoss, 0)}</span> net loss, which cancels it.
              </>
            ) : (
              <>It wouldn&apos;t add any tax at your rates.</>
            )}
          </>
        ) : gain <= -0.5 ? (
          <>
            {" "}
            at a <span className="data">{fmtUsd(-gain, 0)}</span> loss{terms}, so no tax on it.
            {cuts ? (
              <>
                {" "}
                It would cut this year&apos;s bill by about{" "}
                <span className="data">{fmtUsd(-s.taxUsd, 0)}</span>.
              </>
            ) : (
              " The loss lowers your income tax instead (up to $3,000 a year, the rest carries over)."
            )}
          </>
        ) : (
          <>, about what you paid, so no tax on it.</>
        )}
      </p>
      <SellAllByHolding rows={Object.values(byAsset)} total={s} ytdGain={ytdGain} ytdLoss={ytdLoss} />
      <p className="max-w-2xl text-xs text-muted-foreground">
        {s.untaxedAccounts.length > 0 && (
          <>
            Not counted: {list(s.untaxedAccounts.map((a) => a.name))} (
            <span className="data">
              {fmtUsd(
                s.untaxedAccounts.reduce((t, a) => t + a.valueUsd, 0),
                0,
              )}
            </span>
            ), since sales inside retirement accounts aren&apos;t taxed.{" "}
          </>
        )}
        {s.disallowedLossUsd >= 1 && (
          <>
            A <span className="data">{fmtUsd(s.disallowedLossUsd, 0)}</span> loss is left out: a
            recent buy in a retirement account rules it out for good.{" "}
          </>
        )}
        {s.carryforwardUsd >= 1 && (
          <>
            Includes your <span className="data">{fmtUsd(s.carryforwardUsd, 0)}</span> carried-over
            loss.{" "}
          </>
        )}
        Uses your{" "}
        <button
          type="button"
          onClick={onProfile}
          className="underline underline-offset-2 hover:text-foreground"
        >
          Tax Profile
        </button>{" "}
        rates and today&apos;s prices, on top of this year&apos;s sales.
      </p>
    </Section>
  );
}

/**
 * Zero-input view. Leads with the plain answer ("do I owe anything?"), then
 * only the sections that have something in them — a user who has never sold
 * sees one sentence, not a wall of $0.00 boxes (`tax-center-noisy-zero-states`).
 * Every opportunity is one ranked "Moves available now" list (R-003,
 * `taxMoves` in core); the chat snapshot carries the same list.
 */
export function NowTab({
  onNavigate,
}: {
  onNavigate: (tab: "harvest" | "cash" | "profile") => void;
}) {
  const trpc = useTRPC();
  const { portfolioId } = usePortfolio();
  const { complete: income } = useIncome();
  const now = useQuery(
    trpc.tax.now.queryOptions(
      { portfolioId: portfolioId ?? undefined, income },
      { placeholderData: keepPreviousData },
    ),
  );

  if (now.isError && !now.data) {
    return <TabError what="your tax picture" onRetry={() => void now.refetch()} />;
  }
  if (!now.data) {
    return <TabLoading label="Working out your tax picture…" className="h-72" />;
  }

  const d = now.data;
  const isYearEnd = d.daysLeftInTaxYear <= 90;
  const netYtd = d.ytdShortTermGain + d.ytdLongTermGain;
  const hasSales = Math.abs(d.ytdShortTermGain) >= 0.5 || Math.abs(d.ytdLongTermGain) >= 0.5;
  const owes = d.taxOwedSoFarUsd >= 0.5;
  const soldUsd = d.ytdSales.reduce((s, x) => s + x.proceeds, 0);
  // The year truncated the labels in a 2-column phone strip; the verdict says "this year".
  const yearTag = <span className="hidden sm:inline"> · {d.taxYear}</span>;
  // A few dollars of tax is less than the spread on a sell-and-rebuy, and a
  // "Don't sell before…" row worth ~$1 is homework for a dollar (luna). An
  // on-hold row that clears next year can't be priced, so its loss decides.
  const moves = d.moves.filter((m) =>
    m.kind === "on_hold" && m.taxSavedUsd === null ? m.lossUsd >= 5 : (m.taxSavedUsd ?? 0) >= 5,
  );
  const canHarvest = d.movesTaxSavedUsd >= 5;
  const hasLocks = moves.some((m) => m.kind === "lock");
  const lossMoves = d.moves.filter((m) => "landing" in m && m.landing).length;
  const hasZeroGains = moves.some((m) => m.kind === "zero_gain");
  // The welcome bracket says 0% long-term, but without an income figure the
  // room can't be sized (R-003).
  const askIncome = !income && d.inZeroRateBand && d.hasLongTermGains;
  const b = d.movesBreakdown;
  const unusedDeduction = d.deductionRoomUsd - b.ordinaryDeductionUsd;

  return (
    <div className="grid grid-cols-1 gap-10">
      <div className="grid gap-4">
        <p className="max-w-2xl text-lg leading-snug">
          {owes ? (
            <>
              Your sales this year mean about{" "}
              <span className="data">{fmtUsd(d.taxOwedSoFarUsd, 0)}</span> in capital-gains
              tax so far, settled when you file your {d.taxYear} return in April.
            </>
          ) : hasSales && netYtd < 0 ? (
            <>
              You owe no capital-gains tax right now. Your sales this year net to a loss of{" "}
              <span className="data">{fmtUsd(-netYtd, 0)}</span>, which lowers your income
              tax instead.
            </>
          ) : (
            <>
              You owe no capital-gains tax right now
              {hasSales ? "." : ": you haven't sold anything at a gain this year."}
            </>
          )}
          {canHarvest && (
            <>
              {" "}
              Selling a few positions that are down could save you about{" "}
              <span className="data">{fmtUsd(d.movesTaxSavedUsd, 0)}</span>.
            </>
          )}
        </p>

        {hasSales && (
          <StatStrip
            cols={d.ytdSales.length > 0 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-1 sm:grid-cols-3"}
          >
            {/* What the year's sales brought in (barristan: "I wanted dollars
                withdrawn and what I'll owe in April"). */}
            {d.ytdSales.length > 0 && (
              <StatTile
                hero={false}
                label={<>Sales brought in{yearTag}</>}
                value={fmtUsd(soldUsd)}
                subTone="text-muted-foreground"
                sub={`from ${plural(d.ytdSales.length, "sale")} in taxable accounts`}
              />
            )}
            <StatTile
              hero={false}
              label={<>Short-term gains{yearTag}</>}
              value={fmtUsd(d.ytdShortTermGain)}
              tone={gainClass(d.ytdShortTermGain)}
              subTone="text-muted-foreground"
              sub="held a year or less"
            />
            <StatTile
              hero={false}
              label={<>Long-term gains{yearTag}</>}
              value={fmtUsd(d.ytdLongTermGain)}
              tone={gainClass(d.ytdLongTermGain)}
              subTone="text-muted-foreground"
              sub="lower tax rate"
            />
            <StatTile
              hero={false}
              label="Days left this year"
              value={String(d.daysLeftInTaxYear)}
              sub="sales count through Dec 31"
            />
          </StatStrip>
        )}

        <SalesBehindTotals data={d} />

        <p className="text-xs text-muted-foreground">
          {hasSales
            ? "Every number here builds on these gains. Sold something outside this app?"
            : "Sold something outside this app?"}{" "}
          <button
            type="button"
            onClick={() => onNavigate("profile")}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Add it in Tax Profile
          </button>
        </p>
      </div>

      {moves.length > 0 && (
        <Section
          title="Moves available now"
          aside={
            canHarvest && (
              <Button size="sm" variant="outline" onClick={() => onNavigate("harvest")}>
                See the plan
              </Button>
            )
          }
        >
          <p className="-mt-2 text-sm text-muted-foreground">
            Biggest saving first. Sales count for this tax year through Dec 31
            {isYearEnd && (
              <>
                {" "}
                (<span className="data">{d.daysLeftInTaxYear}</span> days left)
              </>
            )}
            .
          </p>
          <TooltipProvider delayDuration={150}>
            <ul className="grid grid-cols-1 divide-y border-y">
              {moves.map((m) => (
                <li key={`${m.kind}-${m.assetId}`} className="grid gap-1.5 py-2.5 text-sm">
                  <div className="flex items-center gap-3">
                    <AssetLogo symbol={m.symbol} assetClass={m.assetClass} size={22} />
                    <MoveText move={m} />
                    <span className="ml-auto shrink-0 text-right">
                      {m.taxSavedUsd === null ? (
                        <span className="text-muted-foreground">clears next year</span>
                      ) : (
                        <SavingMath move={m} rates={d.ratesUsed} stacked={lossMoves > 1}>
                          <span className="text-gain">
                            saves <span className="data">~{fmtUsd(m.taxSavedUsd, 0)}</span>
                            {m.kind === "zero_gain" && " later"}
                            {m.kind === "on_hold" && " by waiting"}
                          </span>
                        </SavingMath>
                      )}
                    </span>
                  </div>
                  <MovePurchases move={m} />
                </li>
              ))}
            </ul>
          </TooltipProvider>
          {canHarvest && (
            <div className="grid gap-3">
              <p className="text-sm">
                Taking every loss above books{" "}
                <span className="data">{fmtUsd(b.totalHarvestedLossUsd, 0)}</span> and saves
                about <span className="data">{fmtUsd(d.movesTaxSavedUsd, 0)}</span>
                {b.ordinaryDeductionUsd >= 1 && unusedDeduction >= 1 && (
                  <>
                    , with <span className="data">{fmtUsd(unusedDeduction, 0)}</span>{" "}
                    of this year&apos;s $3,000 income deduction still unused
                  </>
                )}
                .
              </p>
              <LossBreakdownBar breakdown={b} />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {hasLocks &&
              "Under current US law the 30-day rule for stocks and funds doesn't cover crypto, so you can buy it straight back. That resets your cost lower, which moves tax to a later sale rather than erasing it. "}
            {hasZeroGains && (
              <>
                The 0% lines use the{" "}
                <span className="data">{fmtUsd(d.zeroRateRoomUsd ?? 0, 0)}</span> of room your
                income leaves in the 0% long-term bracket; buying straight back is fine for a
                gain, and the saving assumes 15% on a later sale. Your state may still tax the
                gain.{" "}
              </>
            )}
            Savings use your Tax Profile rates and assume today&apos;s prices.
          </p>
        </Section>
      )}

      {askIncome && (
        <p className="-mt-6 max-w-2xl text-sm text-muted-foreground">
          Your bracket may let you take long-term gains at 0% this year.{" "}
          <button
            type="button"
            onClick={() => onNavigate("profile")}
            className="text-primary underline underline-offset-2"
          >
            Add your income in Tax Profile
          </button>{" "}
          to see how much.
        </p>
      )}

      {d.sellAll && (
        <SellAllSection
          sellAll={d.sellAll}
          byAsset={d.sellAllByAsset}
          ytdNet={netYtd}
          onProfile={() => onNavigate("profile")}
        />
      )}

      <Section
        title="Need cash?"
        aside={
          <Button size="sm" variant="outline" onClick={() => onNavigate("cash")}>
            Plan a sale
          </Button>
        }
      >
        <p className="-mt-2 text-sm text-muted-foreground">
          Tell us how much you need and we&apos;ll pick the shares that cost you the least
          tax to sell.
        </p>
      </Section>
    </div>
  );
}
