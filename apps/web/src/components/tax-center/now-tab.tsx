"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Clock, Sparkles } from "lucide-react";
import Link from "next/link";
import { AssetLogo } from "@/components/asset-logo";
import { usePortfolio } from "@/components/portfolio-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";
import { fmtUsd, gainClass } from "@/lib/viz";

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

  return (
    <div className="grid gap-4">
      {isYearEnd && (
        <Card className="border-primary/30 bg-secondary/40">
          <CardContent className="flex items-center gap-3 py-4">
            <CalendarClock className="size-5 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-semibold">
                {d.daysLeftInTaxYear} day{d.daysLeftInTaxYear === 1 ? "" : "s"} left in the
                tax year
              </p>
              <p className="text-xs text-muted-foreground">
                Losses harvested and long-term timing decisions only count if they happen
                before December 31.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 py-5">
          <Sparkles className="size-6 shrink-0 text-muted-foreground" />
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">Available right now</p>
            <p className="figure text-2xl">
              {fmtUsd(d.harvestEstTaxSavedUsd)}
              <span className="ml-2 font-sans text-sm font-normal tracking-normal text-muted-foreground">
                in estimated tax savings from {d.harvestOpportunityCount} loss lot
                {d.harvestOpportunityCount === 1 ? "" : "s"}
                {d.blockedCount > 0 &&
                  ` (${d.blockedCount} more blocked by the wash-sale rule)`}
              </span>
            </p>
          </div>
          {d.harvestOpportunityCount > 0 && (
            <Button onClick={() => onNavigate("harvest")}>Review harvest plan</Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 py-4">
          <p className="text-xs font-medium text-muted-foreground">
            Your capital gains so far this year
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Short-term</p>
              <p className={`figure text-xl ${gainClass(d.ytdShortTermGain)}`}>
                {fmtUsd(d.ytdShortTermGain)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Long-term</p>
              <p className={`figure text-xl ${gainClass(d.ytdLongTermGain)}`}>
                {fmtUsd(d.ytdLongTermGain)}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            This is what every number on this page is measured against — a loss that offsets
            a gain here is worth your full tax rate; one with nothing left to offset only
            carries forward, worth less.{" "}
            <button
              type="button"
              onClick={() => onNavigate("profile")}
              className="underline hover:text-foreground"
            >
              Edit in Tax Profile →
            </button>
          </p>
        </CardContent>
      </Card>

      {d.harvestPreview.length > 0 && (
        <Card>
          <CardContent className="grid gap-3 py-4">
            <p className="text-xs font-medium text-muted-foreground">Top opportunities</p>
            {d.harvestPreview.map((s, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <AssetLogo symbol={s.lot.symbol} assetClass={s.lot.assetClass} size={22} />
                <span className="font-medium">{s.lot.symbol}</span>
                <span className="text-muted-foreground">{s.lot.accountName}</span>
                <span className="ml-auto data text-loss">
                  {fmtUsd(s.realizedGain)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {d.ripeningSoon.length > 0 && (
        <Card>
          <CardContent className="grid gap-3 py-4">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Clock className="size-3.5" /> Going long-term soon
            </p>
            {d.ripeningSoon.map((r, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <AssetLogo symbol={r.lot.symbol} assetClass={r.lot.assetClass} size={22} />
                <Link href={`/positions/${r.lot.assetId}`} className="font-medium hover:underline">
                  {r.lot.symbol}
                </Link>
                <span className="text-muted-foreground">
                  long-term in {r.daysUntilLongTerm} day{r.daysUntilLongTerm === 1 ? "" : "s"}
                </span>
                {r.estSavingsIfWaited > 0.5 && (
                  <span className="ml-auto text-gain">
                    waiting saves <span className="data">~{fmtUsd(r.estSavingsIfWaited)}</span>
                  </span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex items-center justify-between py-4">
          <div>
            <p className="text-sm font-medium">Need to raise cash?</p>
            <p className="text-xs text-muted-foreground">
              Find the lots that minimize what you pay in tax.
            </p>
          </div>
          <Button variant="outline" onClick={() => onNavigate("cash")}>
            Plan a sale
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
