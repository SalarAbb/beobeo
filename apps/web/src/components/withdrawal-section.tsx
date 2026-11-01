"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Section } from "@/components/page-section";
import { usePortfolio } from "@/components/portfolio-context";
import { useIncome } from "@/components/tax-center/use-income";
import { Button } from "@/components/ui/button";
import { RAISE_CASH_DEFAULT, RAISE_CASH_KEY, type RaiseCashState } from "@/lib/raise-cash-state";
import type { WithdrawalPace } from "@/lib/next-buy-defaults";
import { useTRPC } from "@/lib/trpc";
import { useStoredState } from "@/lib/use-stored-state";
import { fmtUsd } from "@/lib/viz";

/**
 * Shown instead of "Where should my next buy go?" when money mostly comes out
 * of the portfolio (`withdrawalPace`). barristan sells $3,500 a month to live
 * on; the dashboard asked where his "usual" $80,000 should go and never said
 * what he'd taken out this year or what he'd owe in April. This says both, and
 * "Plan the next $X" opens Raise Cash with that amount filled in. The buy
 * question stays one tap away.
 */
export function WithdrawalSection({
  pace,
  nextBuy,
}: {
  pace: WithdrawalPace;
  nextBuy: ReactNode;
}) {
  const trpc = useTRPC();
  const { portfolioId } = usePortfolio();
  const { complete: income } = useIncome();
  const [, setRaise] = useStoredState<RaiseCashState>(RAISE_CASH_KEY, RAISE_CASH_DEFAULT);
  const [buying, setBuying] = useState(false);
  // The same input the Tax Center and the nav's warm-up use, so they share one entry.
  const now = useQuery(
    trpc.tax.now.queryOptions({ portfolioId: portfolioId ?? undefined, income }),
  );
  const owed = now.data?.taxOwedSoFarUsd;
  const gain = now.data ? now.data.ytdShortTermGain + now.data.ytdLongTermGain : undefined;

  return (
    <>
      <Section title="Taking money out">
        <div className="grid max-w-2xl gap-2 text-sm">
          <p>
            {pace.thisYearUsd >= 1 ? (
              <>
                You&apos;ve taken out <strong className="data">{fmtUsd(pace.thisYearUsd)}</strong> so far
                in {pace.year}, after anything you put back
              </>
            ) : (
              <>You haven&apos;t taken anything out yet in {pace.year}</>
            )}
            : about <span className="data">{fmtUsd(pace.monthlyUsd)}</span> a month over the last 12
            months.
          </p>
          <p className="text-muted-foreground">
            {now.isError
              ? "Couldn't work out the tax on this year's sales right now; the Tax Center has it."
              : owed === undefined
                ? "Working out the tax on this year's sales…"
                : owed >= 1
                  ? <>
                      This year&apos;s sales in taxable accounts made{" "}
                      <span className="data text-foreground">{fmtUsd(gain ?? 0)}</span> of gain, so
                      the tax so far is about{" "}
                      <span className="data text-foreground">{fmtUsd(owed)}</span>, settled when you
                      file your {pace.year} return in April.
                    </>
                  : "This year's sales owe no capital-gains tax so far."}
          </p>
          <MonthList pace={pace} sales={now.data?.ytdSales} />
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button asChild size="sm">
              <Link
                href="/tax-center?tab=cash"
                onClick={() =>
                  setRaise((s) => ({
                    ...s,
                    amountInput: String(pace.usualUsd),
                    target: pace.usualUsd,
                  }))
                }
              >
                Plan the next {fmtUsd(pace.usualUsd)} at the least tax
              </Link>
            </Button>
            <Link
              href="/tax-center?tab=now"
              className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              See this year&apos;s sales
            </Link>
            <button
              type="button"
              onClick={() => setBuying((b) => !b)}
              aria-expanded={buying}
              className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              {buying ? "Hide the buy question" : "Putting money in instead? Weigh a buy"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {fmtUsd(pace.usualUsd)} is what you usually take out. Raise Cash picks which shares to
            sell so the tax is as low as it can be.
          </p>
        </div>
      </Section>
      {buying && nextBuy}
    </>
  );
}

type Sale = {
  soldAt: string;
  symbol: string;
  proceeds: number;
  shortTermGain: number;
  longTermGain: number;
};

const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" });

/**
 * This year's money out by month (the invested line, so the rows sum to the
 * sentence above), each with the sales behind it from the Tax Center's list:
 * barristan's one $3,500 a month was a VTI and a VXUS sale there, and he
 * couldn't tie it to his paper record (mission 107). Closed by default.
 */
function MonthList({ pace, sales }: { pace: WithdrawalPace; sales: Sale[] | undefined }) {
  const months = pace.byMonth;
  if (months.length < 2) return null;
  const byMonth = new Map<string, Sale[]>();
  for (const s of sales ?? []) {
    const key = s.soldAt.slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), s]);
  }
  const total = months.reduce((t, m) => t + m.outUsd, 0);
  const out = (usd: number) => (usd >= 0 ? `${fmtUsd(usd)} out` : `${fmtUsd(-usd)} put in`);
  return (
    <details>
      <summary className="w-fit cursor-pointer text-primary marker:text-muted-foreground">
        Show {pace.year} month by month
      </summary>
      <ul className="mt-2 grid divide-y border-y">
        {months.map((m) => {
          const sold = byMonth.get(m.month) ?? [];
          const gain = sold.reduce((t, s) => t + s.shortTermGain + s.longTermGain, 0);
          return (
            <li
              key={m.month}
              className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-0.5 py-2"
            >
              <span className="font-medium">{monthName(m.month)}</span>
              <span className="data text-right">{out(m.outUsd)}</span>
              <span className="data text-xs text-muted-foreground">
                {sold.length > 0
                  ? `Sold ${sold.map((s) => `${s.symbol} ${fmtUsd(s.proceeds)}`).join(" + ")}`
                  : "No sales in taxable accounts"}
              </span>
              <span className="data text-right text-xs text-muted-foreground">
                {sold.length > 0 && `gain ${fmtUsd(gain)}`}
              </span>
            </li>
          );
        })}
        <li className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-0.5 py-2 font-medium">
          <span>Together</span>
          <span className="data text-right">{out(total)}</span>
          {sales && sales.length > 0 && (
            <span className="data col-start-2 text-right text-xs font-normal text-muted-foreground">
              gain {fmtUsd(sales.reduce((t, s) => t + s.shortTermGain + s.longTermGain, 0))}
            </span>
          )}
        </li>
      </ul>
    </details>
  );
}
