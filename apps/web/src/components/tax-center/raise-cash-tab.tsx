"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Section, StatStrip, StatTile } from "@/components/page-section";
import { usePortfolio } from "@/components/portfolio-context";
import { LossBreakdownBar } from "@/components/tax-center/loss-breakdown-bar";
import { PlanView } from "@/components/tax-center/plan-view";
import { Button } from "@/components/ui/button";
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
    <div className="grid gap-10">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <label htmlFor="raise-amount" className="eyebrow">
            I need to raise
          </label>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">$</span>
            <Input
              id="raise-amount"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              inputMode="decimal"
              className="data w-40"
            />
            <Button onClick={submit}>Plan</Button>
          </div>
        </div>

        <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(doNotSell.length > 0 && "bg-accent text-primary")}
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
      </div>

      {target === null ? null : plan.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : d ? (
        <>
          <div className="grid gap-4">
            <p className="max-w-2xl text-lg leading-snug">
              {d.headlineSavingsVsFifo >= 0.5 ? (
                <>
                  Selling these shares instead of your broker&apos;s default keeps{" "}
                  <span className="data">{fmtUsd(d.headlineSavingsVsFifo)}</span> more in your
                  pocket.
                </>
              ) : (
                "Here your broker's default (oldest shares first) already costs the least tax."
              )}
            </p>
            <StatStrip cols="grid-cols-1 sm:grid-cols-3">
              <StatTile
                hero={false}
                label={d.optimized.totalTaxCost < 0 ? "Tax this saves" : "Tax this costs"}
                value={fmtUsd(Math.abs(d.optimized.totalTaxCost))}
                tone={d.optimized.totalTaxCost < -0.005 ? "text-gain" : undefined}
                subTone="text-muted-foreground"
                sub="estimated, at your saved rates"
              />
              <StatTile
                hero={false}
                label="You keep after tax"
                value={fmtUsd(d.optimized.totalAfterTax)}
              />
              <StatTile
                hero={false}
                label="Broker default would keep"
                value={fmtUsd(d.fifo.totalAfterTax)}
                sub="oldest shares first (FIFO)"
              />
            </StatStrip>
          </div>

          {d.breakdown.totalHarvestedLossUsd > 0.5 && (
            <Section title="Where the losses in this plan go">
              <LossBreakdownBar breakdown={d.breakdown} />
            </Section>
          )}

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
