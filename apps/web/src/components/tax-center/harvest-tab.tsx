"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Section, StatStrip, StatTile } from "@/components/page-section";
import { usePortfolio } from "@/components/portfolio-context";
import { LossBreakdownBar } from "@/components/tax-center/loss-breakdown-bar";
import { PlanView } from "@/components/tax-center/plan-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";
import { fmtUsd } from "@/lib/viz";

export function HarvestTab() {
  const trpc = useTRPC();
  const { portfolioId } = usePortfolio();
  const scope = { portfolioId: portfolioId ?? undefined };

  const [capInput, setCapInput] = useState("");
  const [cap, setCap] = useState<number | undefined>(undefined);

  const harvest = useQuery(trpc.tax.harvest.queryOptions({ ...scope, lossCapUsd: cap }));

  function applyCap() {
    const n = Number(capInput.replace(/[^0-9.]/g, ""));
    setCap(Number.isFinite(n) && n > 0 ? n : undefined);
  }

  const d = harvest.data;
  const hasPlan = !!d && d.sales.length > 0;

  return (
    <div className="grid gap-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-md text-sm text-muted-foreground">
          Sell the positions that are below what you paid, so the loss cancels out gains or
          trims your income tax. To count for this year, sell before December 31.
        </p>
        <div className="grid gap-1.5">
          <label htmlFor="harvest-cap" className="eyebrow">
            Take losses up to
          </label>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">$</span>
            <Input
              id="harvest-cap"
              value={capInput}
              onChange={(e) => setCapInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyCap()}
              placeholder="no limit"
              inputMode="decimal"
              className="data w-28"
            />
            <Button variant="outline" onClick={applyCap}>
              Apply
            </Button>
            {cap !== undefined && (
              <Button
                variant="ghost"
                onClick={() => {
                  setCap(undefined);
                  setCapInput("");
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      {harvest.isLoading || !d ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          {hasPlan ? (
            <>
              <StatStrip cols="grid-cols-1 sm:grid-cols-3">
                <StatTile
                  hero={false}
                  label="Tax this saves"
                  value={fmtUsd(d.estTaxSavedUsd)}
                  tone="text-gain"
                  subTone="text-muted-foreground"
                  sub="estimated, at your saved rates"
                />
                <StatTile
                  hero={false}
                  label="Losses taken"
                  value={fmtUsd(d.breakdown.totalHarvestedLossUsd)}
                  sub={`${d.sales.length} ${d.sales.length === 1 ? "sale" : "sales"}`}
                />
                <StatTile
                  hero={false}
                  label="Cash freed up"
                  value={fmtUsd(d.totalProceeds)}
                  sub="buy something different to stay invested"
                />
              </StatStrip>
              <Section title="Where the losses go">
                <LossBreakdownBar breakdown={d.breakdown} />
              </Section>
            </>
          ) : (
            <p className="text-lg">
              Nothing to harvest right now
              {d.blocked.length > 0
                ? ": the positions that are down were bought again recently."
                : ": none of your positions are below what you paid."}
            </p>
          )}

          {(hasPlan || d.blocked.length > 0) && (
            <PlanView
              sales={d.sales}
              blocked={d.blocked}
              totalProceeds={d.totalProceeds}
              startingRealizedGain={d.startingRealizedGain}
            />
          )}
        </>
      )}
    </div>
  );
}
