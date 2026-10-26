"use client";

import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { AssetLogo } from "@/components/asset-logo";
import { Section, StatStrip, StatTile } from "@/components/page-section";
import { usePortfolio } from "@/components/portfolio-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";
import { fmtQty, fmtUsd, gainClass } from "@/lib/viz";
import type { AppRouter } from "@/server/routers";
import { LossBreakdownBar } from "./loss-breakdown-bar";

type Move = inferRouterOutputs<AppRouter>["tax"]["now"]["moves"][number];

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
          back before <span className="data">{day(m.rebuyAfter)}</span> (wash-sale rule)
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
          a recent buy puts its <span className="data">{fmtUsd(m.lossUsd, 0)}</span>{" "}loss on hold
          (wash-sale rule); buying more restarts the wait
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
  }
  return (
    <div className="min-w-0">
      <div>{action}</div>
      <div className="text-xs text-muted-foreground sm:truncate">{why}</div>
    </div>
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
  const scope = { portfolioId: portfolioId ?? undefined };
  const now = useQuery(trpc.tax.now.queryOptions(scope));

  if (now.isLoading || !now.data) {
    return <Skeleton className="h-72 w-full" />;
  }

  const d = now.data;
  const isYearEnd = d.daysLeftInTaxYear <= 90;
  const netYtd = d.ytdShortTermGain + d.ytdLongTermGain;
  const hasSales = Math.abs(d.ytdShortTermGain) >= 0.5 || Math.abs(d.ytdLongTermGain) >= 0.5;
  const owes = d.taxOwedSoFarUsd >= 0.5;
  // A few dollars of tax is less than the spread on a sell-and-rebuy.
  const moves = d.moves.filter((m) =>
    m.kind === "on_hold" ? m.lossUsd >= 5 : (m.taxSavedUsd ?? 0) >= 5,
  );
  const canHarvest = d.movesTaxSavedUsd >= 5;
  const hasLocks = moves.some((m) => m.kind === "lock");
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
              tax so far.
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
          <StatStrip cols="grid-cols-2 sm:grid-cols-3">
            <StatTile
              hero={false}
              label="Short-term gains"
              value={fmtUsd(d.ytdShortTermGain)}
              tone={gainClass(d.ytdShortTermGain)}
              subTone="text-muted-foreground"
              sub="held a year or less"
            />
            <StatTile
              hero={false}
              label="Long-term gains"
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
              className="col-span-2 sm:col-span-1"
            />
          </StatStrip>
        )}

        <p className="text-xs text-muted-foreground">
          {hasSales
            ? "Every number here is measured against these gains."
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
          <ul className="grid grid-cols-1 divide-y border-y">
            {moves.map((m) => (
              <li
                key={`${m.kind}-${m.assetId}`}
                className="flex items-center gap-3 py-2.5 text-sm"
              >
                <AssetLogo symbol={m.symbol} assetClass={m.assetClass} size={22} />
                <MoveText move={m} />
                <span className="ml-auto shrink-0 text-right">
                  {m.taxSavedUsd === null ? (
                    <span className="text-muted-foreground">clears next year</span>
                  ) : (
                    <span className="text-gain">
                      {m.kind === "on_hold" ? "then saves" : "saves"}{" "}
                      <span className="data">~{fmtUsd(m.taxSavedUsd, 0)}</span>
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
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
              "Crypto has no wash-sale rule under current US law, so you can buy it straight back. That resets your cost lower, which moves tax to a later sale rather than erasing it. "}
            Savings use your Tax Profile rates and assume today&apos;s prices.
          </p>
        </Section>
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
