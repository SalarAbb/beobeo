"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AssetLogo } from "@/components/asset-logo";
import { Section } from "@/components/page-section";
import { usePortfolio } from "@/components/portfolio-context";
import { TabLoading } from "@/components/tax-center/tab-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTRPC } from "@/lib/trpc";
import { fmtCompactUsd, fmtUsd, useVizTheme } from "@/lib/viz";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pct = (x: number | null) => (x === null ? "—" : `${x.toFixed(2)}%`);

function cadence(paymentsPerYear: number) {
  if (paymentsPerYear >= 11) return "Monthly";
  if (paymentsPerYear >= 3 && paymentsPerYear <= 5) return "Quarterly";
  if (paymentsPerYear === 1) return "Once a year";
  return `${paymentsPerYear}× a year`;
}

/** "A, B and C" */
function list(items: string[]) {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * "What do my shares pay me?" (olenna: "monthly dividend income, yield on
 * cost, and which holding pays me the most"). From `portfolio.dividends`:
 * the last 12 months' payouts per share (market data) × the shares held now.
 * Renders nothing for a portfolio with nothing that could pay (crypto only).
 */
export function DividendIncomeSection({ holdings }: { holdings: { symbol: string; class: string }[] }) {
  const trpc = useTRPC();
  const theme = useVizTheme();
  const { portfolioId } = usePortfolio();
  const canPay = holdings.some((h) => h.class !== "crypto");
  const query = useQuery({
    ...trpc.portfolio.dividends.queryOptions({ portfolioId: portfolioId ?? undefined }),
    enabled: canPay,
  });
  if (!canPay || query.isError) return null;

  const d = query.data;
  if (!d) {
    return (
      <Section title="Dividend income">
        <TabLoading label="Working out what your holdings pay…" className="h-24" />
      </Section>
    );
  }
  // Nothing paid and nothing unknown: no section (a growth-only portfolio).
  if (d.holdings.length === 0 && d.unavailable.length === 0) return null;

  const classOf = new Map(holdings.map((h) => [h.symbol, h.class]));
  const payersIn = (month: number) =>
    d.holdings.filter((h) => h.months.includes(month)).map((h) => h.key);
  const bars = d.byMonth.map((m) => ({ ...m, label: MONTHS[m.month - 1]! }));

  return (
    <Section title="Dividend income">
      {d.holdings.length > 0 ? (
        <p className="max-w-prose text-sm">
          At the shares you hold now, your holdings paid about{" "}
          <span className="figure">{fmtUsd(d.yearlyUsd)}</span> over the last 12 months, about{" "}
          <span className="figure">{fmtUsd(d.monthlyAverageUsd)}</span> a month: {pct(d.yieldOnValuePct)}{" "}
          of what they&apos;re worth and {pct(d.yieldOnCostPct)} of what you paid.
          {d.holdings.length > 1 && (
            <>
              {" "}
              {d.holdings[0]!.key} pays the most, {fmtUsd(d.holdings[0]!.yearlyUsd)} a year.
            </>
          )}
        </p>
      ) : (
        <p className="max-w-prose text-sm text-muted-foreground">
          Couldn&apos;t get payouts for {list(d.unavailable)} right now. Try again in a while.
        </p>
      )}

      {d.holdings.length > 0 && (
        <>
          <div className="data h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bars} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barCategoryGap="25%">
                <CartesianGrid vertical={false} stroke={theme.grid} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={{ stroke: theme.baseline }}
                  tick={{ fill: theme.muted, fontSize: 11 }}
                  interval={0}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: theme.muted, fontSize: 11 }}
                  tickFormatter={(v: number) => fmtCompactUsd(v)}
                  width={56}
                  domain={[0, "auto"]}
                />
                <Tooltip
                  cursor={{ fill: theme.grid, opacity: 0.4 }}
                  content={({ payload }) => {
                    const p = payload?.[0]?.payload as (typeof bars)[number] | undefined;
                    if (!p) return null;
                    const who = payersIn(p.month);
                    return (
                      <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                        <p className="font-medium">{p.label}</p>
                        <p className="data">
                          {p.usd > 0 ? fmtUsd(p.usd) : "No payouts"}
                          {who.length > 0 && <span className="text-muted-foreground"> · {list(who)}</span>}
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="usd"
                  fill={theme.series[0]}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={36}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Holding</TableHead>
                <TableHead className="hidden sm:table-cell">Pays</TableHead>
                <TableHead className="hidden text-right md:table-cell">Per share, last 12 months</TableHead>
                <TableHead className="text-right">A year</TableHead>
                <TableHead className="text-right">Of its value</TableHead>
                <TableHead className="text-right">Of what you paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.holdings.map((h) => (
                <TableRow key={h.key}>
                  <TableCell>
                    <span className="flex items-center gap-2 font-medium">
                      <AssetLogo symbol={h.key} assetClass={classOf.get(h.key) ?? "stock"} size={20} />
                      {h.key}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {cadence(h.paymentsPerYear)}
                  </TableCell>
                  <TableCell className="data hidden text-right md:table-cell">
                    ${h.perShareYearly.toFixed(h.perShareYearly < 1 ? 4 : 2)}
                  </TableCell>
                  <TableCell className="data text-right">{fmtUsd(h.yearlyUsd)}</TableCell>
                  <TableCell className="data text-right">{pct(h.yieldOnValuePct)}</TableCell>
                  <TableCell className="data text-right">{pct(h.yieldOnCostPct)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      <p className="max-w-prose text-xs text-muted-foreground">
        {d.holdings.length > 0 && (
          <>
            An estimate from what each holding paid per share over the last 12 months (bars by
            the month it went ex-dividend; the cash usually arrives a few weeks later), not a
            promise: companies can raise or cut payouts.
            {d.noPayments.length > 0 && <> {list(d.noPayments)} paid nothing in that time.</>}
            {d.unavailable.length > 0 && (
              <> Couldn&apos;t get payouts for {list(d.unavailable)} right now.</>
            )}{" "}
          </>
        )}
        {d.recordedLast12MonthsUsd > 0 ? (
          <>You recorded {fmtUsd(d.recordedLast12MonthsUsd)} of dividends in Beobeo over the same year.</>
        ) : (
          <>
            None recorded in Beobeo yet ·{" "}
            <Link href="/transactions?add=dividend" className="underline underline-offset-2">
              add a payout
            </Link>
          </>
        )}
      </p>
    </Section>
  );
}
