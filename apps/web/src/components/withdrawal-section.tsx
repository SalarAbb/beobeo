"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Section } from "@/components/page-section";
import { usePortfolio } from "@/components/portfolio-context";
import { useIncome } from "@/components/tax-center/use-income";
import { Button } from "@/components/ui/button";
import { RAISE_CASH_DEFAULT, RAISE_CASH_KEY, type RaiseCashState } from "@/lib/raise-cash-state";
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
  pace: { usualUsd: number; thisYearUsd: number; monthlyUsd: number; year: number };
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
                      Tax on this year&apos;s sales so far: about{" "}
                      <span className="data text-foreground">{fmtUsd(owed)}</span>, settled when you
                      file your {pace.year} return in April.
                    </>
                  : "This year's sales owe no capital-gains tax so far."}
          </p>
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
