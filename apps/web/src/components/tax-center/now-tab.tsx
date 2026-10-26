"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AssetLogo } from "@/components/asset-logo";
import { Section, StatStrip, StatTile } from "@/components/page-section";
import { usePortfolio } from "@/components/portfolio-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";
import { fmtQty, fmtUsd, gainClass } from "@/lib/viz";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Zero-input view. Leads with the plain answer ("do I owe anything?"), then
 * only the sections that have something in them — a user who has never sold
 * sees one sentence, not a wall of $0.00 boxes (`tax-center-noisy-zero-states`).
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
  const canHarvest = d.harvestOpportunityCount > 0 && d.harvestEstTaxSavedUsd >= 0.5;
  // A few dollars of tax is less than the spread on a sell-and-rebuy.
  const locks = d.lossLocks.filter((l) => l.taxSavedUsd >= 5);
  // A lot that's down gains nothing by waiting (and may be a move above).
  const ripening = d.ripeningSoon.filter((r) => r.estSavingsIfWaited >= 0.5);

  return (
    <div className="grid gap-10">
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
              <span className="data">{fmtUsd(d.harvestEstTaxSavedUsd, 0)}</span>.
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

      {locks.length > 0 && (
        <Section title="Moves available now">
          <p className="-mt-2 text-sm text-muted-foreground">
            Crypto has no wash-sale rule under current US law. Sell these at a loss and buy
            them straight back: you keep the same coins and book the loss now.
          </p>
          <ul className="grid divide-y border-y">
            {locks.map((l) => (
              <li key={l.assetId} className="flex items-center gap-3 py-2.5 text-sm">
                <AssetLogo symbol={l.symbol} assetClass={l.assetClass} size={22} />
                <div className="min-w-0">
                  <div>
                    Sell and buy back{" "}
                    <span className="data">{fmtQty(l.quantity)}</span>{" "}
                    <Link href={`/positions/${l.assetId}`} className="font-medium hover:underline">
                      {l.symbol}
                    </Link>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    books a <span className="data">{fmtUsd(l.lossUsd, 0)}</span> loss ·{" "}
                    {l.accounts.join(", ")}
                  </div>
                </div>
                <span className="ml-auto shrink-0 text-right text-gain">
                  saves <span className="data">~{fmtUsd(l.taxSavedUsd, 0)}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Buying back resets your cost lower, so this moves tax to a later sale rather than
            erasing it. Savings use your Tax Profile rates and assume today&apos;s prices.
          </p>
        </Section>
      )}

      {canHarvest && d.harvestPreviewCount > 0 ? (
        <Section
          title="Losses you could take"
          aside={
            <Button size="sm" onClick={() => onNavigate("harvest")}>
              See the plan
            </Button>
          }
        >
          <p className="-mt-2 text-sm text-muted-foreground">
            These are below what you paid. Selling them books the loss, which cancels out
            gains or trims your income tax
            {isYearEnd && (
              <>
                {" "}
                — only if you sell in the next{" "}
                <span className="data">{d.daysLeftInTaxYear}</span> days
              </>
            )}
            .
          </p>
          <ul className="grid divide-y border-y">
            {d.harvestPreview.map((s, i) => (
              <li key={i} className="flex items-center gap-3 py-2.5 text-sm">
                <AssetLogo symbol={s.lot.symbol} assetClass={s.lot.assetClass} size={22} />
                <span className="font-medium">{s.lot.symbol}</span>
                <span className="truncate text-muted-foreground">{s.lot.accountName}</span>
                <span className="data ml-auto text-loss">{fmtUsd(s.realizedGain)}</span>
              </li>
            ))}
          </ul>
          {d.blockedCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {`${plural(d.blockedCount, "more purchase")} on hold: `}
              you bought the same asset again in the last 30 days.
            </p>
          )}
        </Section>
      ) : (
        d.blockedCount > 0 && (
          <Section
            title="Losses on hold"
            aside={
              <Button size="sm" variant="outline" onClick={() => onNavigate("harvest")}>
                See which
              </Button>
            }
          >
            <p className="-mt-2 text-sm text-muted-foreground">
              {`${plural(d.blockedCount, "purchase")} ${d.blockedCount === 1 ? "is" : "are"} below what you paid, `}
              but you bought the same asset again in the last 30 days. Selling now
              wouldn&apos;t count as a loss (the wash-sale rule), so wait until 30 days after
              that buy.
            </p>
          </Section>
        )
      )}

      {ripening.length > 0 && (
        <Section title="Hold a little longer">
          <p className="-mt-2 text-sm text-muted-foreground">
            After a year, a gain is taxed at the lower long-term rate. These cross that line
            soon, so selling them now would cost more.
          </p>
          <ul className="grid divide-y border-y">
            {ripening.map((r, i) => (
              <li key={i} className="flex items-center gap-3 py-2.5 text-sm">
                <AssetLogo symbol={r.lot.symbol} assetClass={r.lot.assetClass} size={22} />
                <Link href={`/positions/${r.lot.assetId}`} className="font-medium hover:underline">
                  {r.lot.symbol}
                </Link>
                <span className="text-muted-foreground">
                  in <span className="data">{r.daysUntilLongTerm}</span>{" "}
                  {r.daysUntilLongTerm === 1 ? "day" : "days"}
                </span>
                <span className="ml-auto text-right text-gain">
                  waiting saves <span className="data">~{fmtUsd(r.estSavingsIfWaited)}</span>
                </span>
              </li>
            ))}
          </ul>
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
