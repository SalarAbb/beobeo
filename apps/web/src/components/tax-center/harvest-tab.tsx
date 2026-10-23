"use client";

import { useQuery } from "@tanstack/react-query";
import { PiggyBank } from "lucide-react";
import { useState } from "react";
import { usePortfolio } from "@/components/portfolio-context";
import { LossBreakdownBar } from "@/components/tax-center/loss-breakdown-bar";
import { PlanView } from "@/components/tax-center/plan-view";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <p className="text-xs text-muted-foreground">
            Sells every eligible unrealized loss (not blocked by the wash-sale rule) —
            year-end harvesting is just this, run before December 31.
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Cap losses at</span>
            <span className="text-muted-foreground">$</span>
            <Input
              value={capInput}
              onChange={(e) => setCapInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyCap()}
              placeholder="no cap"
              inputMode="decimal"
              className="w-28"
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
        </CardContent>
      </Card>

      {harvest.isLoading || !d ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <Card className="border-primary/20 bg-secondary/40">
            <CardContent className="grid gap-4 py-5">
              <div className="flex items-center gap-3">
                <PiggyBank className="size-6 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-xl font-semibold tabular-nums">
                    {fmtUsd(d.estTaxSavedUsd)} estimated tax savings
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {d.sales.length} lot{d.sales.length === 1 ? "" : "s"} harvested ·{" "}
                    {fmtUsd(d.totalProceeds)} in proceeds
                  </p>
                </div>
              </div>
              <LossBreakdownBar breakdown={d.breakdown} />
            </CardContent>
          </Card>

          <PlanView
            sales={d.sales}
            blocked={d.blocked}
            totalProceeds={d.totalProceeds}
            startingRealizedGain={d.startingRealizedGain}
          />
        </>
      )}
    </div>
  );
}
