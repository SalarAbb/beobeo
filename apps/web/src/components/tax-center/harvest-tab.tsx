"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Section, StatStrip, StatTile } from "@/components/page-section";
import { usePortfolio } from "@/components/portfolio-context";
import { LossBreakdownBar } from "@/components/tax-center/loss-breakdown-bar";
import { PlanView } from "@/components/tax-center/plan-view";
import { RetirementNote } from "@/components/tax-center/retirement-note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabError, TabLoading } from "@/components/tax-center/tab-state";
import { useTRPC } from "@/lib/trpc";
import { HARVEST_DEFAULT, HARVEST_KEY, type HarvestState } from "@/lib/harvest-state";
import { useStoredState } from "@/lib/use-stored-state";
import { cn } from "@/lib/utils";
import { fmtUsd } from "@/lib/viz";

export function HarvestTab() {
  const trpc = useTRPC();
  const { portfolioId } = usePortfolio();
  const scope = { portfolioId: portfolioId ?? undefined };

  // Kept on the device for every portfolio: tabs unmount on switch, so a cap held in
  // useState vanished on the way back from All Lots (same as Raise Cash's amount).
  const [{ capInput, cap }, setState] = useStoredState<HarvestState>(HARVEST_KEY, HARVEST_DEFAULT);

  const harvest = useQuery({
    ...trpc.tax.harvest.queryOptions({ ...scope, lossCapUsd: cap ?? undefined }),
    placeholderData: keepPreviousData,
  });

  function applyCap() {
    const n = Number(capInput.replace(/[^0-9.]/g, ""));
    setState({ capInput, cap: Number.isFinite(n) && n > 0 ? n : null });
  }

  const d = harvest.data;
  const hasPlan = !!d && d.sales.length > 0;

  return (
    <div className="grid gap-10">
      <div className="grid gap-3">
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
              onChange={(e) => {
                const v = e.target.value;
                setState((s) => ({ ...s, capInput: v }));
              }}
              onKeyDown={(e) => e.key === "Enter" && applyCap()}
              placeholder="no limit"
              inputMode="decimal"
              className="data w-28"
            />
            <Button variant="outline" onClick={applyCap}>
              Apply
            </Button>
            {cap !== null && (
              <Button
                variant="ghost"
                onClick={() => setState({ capInput: "", cap: null })}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>
      <RetirementNote tab="harvest" />
      </div>

      {harvest.isError && !d ? (
        <TabError what="your harvest plan" onRetry={() => void harvest.refetch()} />
      ) : !d ? (
        <TabLoading label="Looking for losses you could take…" className="h-64" />
      ) : (
        <div
          className={cn(
            "grid gap-10 transition-opacity",
            harvest.isPlaceholderData && "opacity-50",
          )}
        >
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
                : ": nothing in your taxable accounts is below what you paid."}
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
        </div>
      )}
    </div>
  );
}
