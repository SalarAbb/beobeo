"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import { usePortfolio } from "@/components/portfolio-context";
import { LossBreakdownBar } from "@/components/tax-center/loss-breakdown-bar";
import { PlanView } from "@/components/tax-center/plan-view";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";
import { fmtUsd } from "@/lib/viz";
import { cn } from "@/lib/utils";

export function RaiseCashTab() {
  const trpc = useTRPC();
  const { portfolioId } = usePortfolio();
  const scope = { portfolioId: portfolioId ?? undefined };

  const [amountInput, setAmountInput] = useState("10000");
  const [target, setTarget] = useState<number | null>(10000);
  const [doNotSell, setDoNotSell] = useState<string[]>([]);

  const lots = useQuery(trpc.tax.lots.queryOptions(scope));
  const symbols = [...new Set((lots.data ?? []).map((l) => l.symbol))].sort();

  const plan = useQuery({
    ...trpc.tax.plan.queryOptions({ ...scope, targetProceeds: target ?? 0, doNotSell }),
    enabled: target !== null && target > 0,
  });

  function toggleDoNotSell(symbol: string) {
    setDoNotSell((prev) =>
      prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol],
    );
  }

  function submit() {
    const n = Number(amountInput.replace(/[^0-9.]/g, ""));
    setTarget(Number.isFinite(n) && n > 0 ? n : null);
  }

  const d = plan.data;

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              I need to raise
            </label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">$</span>
              <Input
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                inputMode="decimal"
                className="w-40"
              />
              <Button onClick={submit}>Plan</Button>
            </div>
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(doNotSell.length > 0 && "border-primary bg-secondary")}
              >
                {doNotSell.length === 0
                  ? "Do-not-sell list"
                  : `${doNotSell.length} excluded`}
                <ChevronDown className="ml-1 size-3.5 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2" align="start">
              {symbols.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">No holdings yet</p>
              ) : (
                symbols.map((symbol) => (
                  <button
                    key={symbol}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary"
                    onClick={() => toggleDoNotSell(symbol)}
                  >
                    <input
                      type="checkbox"
                      readOnly
                      checked={doNotSell.includes(symbol)}
                      className="accent-primary"
                    />
                    {symbol}
                  </button>
                ))
              )}
            </PopoverContent>
          </Popover>
        </CardContent>
      </Card>

      {target === null ? null : plan.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : d ? (
        <>
          <Card className="border-primary/20 bg-secondary/40">
            <CardContent className="flex items-center gap-3 py-5">
              <TrendingUp className="size-6 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-xl font-semibold tabular-nums">
                  {d.headlineSavingsVsFifo >= 0.5
                    ? `Your broker's FIFO default would cost you ${fmtUsd(d.headlineSavingsVsFifo)} more`
                    : "This plan matches what FIFO would do here"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Optimized nets {fmtUsd(d.optimized.totalAfterTax)} after tax · FIFO would
                  net {fmtUsd(d.fifo.totalAfterTax)} · highest-cost-first would net{" "}
                  {fmtUsd(d.highestCostFirst.totalAfterTax)}
                </p>
              </div>
              {d.breakdown.totalHarvestedLossUsd > 0.5 && (
                <div className="border-t pt-4">
                  <p className="mb-2.5 text-xs font-medium text-muted-foreground">
                    Where the loss in this plan actually goes
                  </p>
                  <LossBreakdownBar breakdown={d.breakdown} />
                </div>
              )}
            </CardContent>
          </Card>

          <PlanView
            sales={d.optimized.sales}
            blocked={d.optimized.blocked}
            totalProceeds={d.optimized.totalProceeds}
            shortfall={d.optimized.shortfall}
            excluded={d.optimized.excluded}
            startingRealizedGain={d.startingRealizedGain}
          />
        </>
      ) : null}
    </div>
  );
}
