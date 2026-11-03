"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, X } from "lucide-react";
import { Section, StatStrip, StatTile } from "@/components/page-section";
import { usePortfolio } from "@/components/portfolio-context";
import { LossBreakdownBar } from "@/components/tax-center/loss-breakdown-bar";
import { PlanView } from "@/components/tax-center/plan-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RetirementNote } from "@/components/tax-center/retirement-note";
import { TabError, TabLoading } from "@/components/tax-center/tab-state";
import {
  RAISE_CASH_DEFAULT,
  RAISE_CASH_KEY,
  raiseCashDoNotSell,
  type RaiseCashState,
} from "@/lib/raise-cash-state";
import { useTRPC } from "@/lib/trpc";
import { useStoredState } from "@/lib/use-stored-state";
import { fmtUsd } from "@/lib/viz";
import { cn } from "@/lib/utils";


function parseAmount(input: string): number | null {
  const n = Number(input.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function RaiseCashTab() {
  const trpc = useTRPC();
  const { portfolioId, portfolios, activeName } = usePortfolio();
  const scope = { portfolioId: portfolioId ?? undefined };

  // Kept on the device: tabs unmount on switch, and petyr's $20,000 kept snapping back to
  // $10,000 every time he checked All Lots (mission 2). One value for every portfolio: the
  // cash you need doesn't change when you switch scope (a per-portfolio key reset it, mission 15).
  const [state, setState] = useStoredState<RaiseCashState>(RAISE_CASH_KEY, RAISE_CASH_DEFAULT);
  const { amountInput, target, doNotSell, accountId: storedAccountId } = state;

  const lots = useQuery(trpc.tax.lots.queryOptions(scope));
  const symbols = [...new Set((lots.data ?? []).map((l) => l.symbol))].sort();
  // The list is shared across portfolios; only count what this one holds.
  const excludedHere = doNotSell.filter((s) => symbols.includes(s)).length;
  // "Sell part of it" on a holding's page plans that holding alone (molly
  // wanted $2,000 of Ginny's VT and got a $10,000 plan across everything,
  // mission 132). It counts once the lots say this portfolio holds it.
  const only = state.only && symbols.includes(state.only) ? state.only : undefined;
  const planDoNotSell = raiseCashDoNotSell(state, symbols);
  // Taxable accounts that hold something here. A stored account this portfolio
  // doesn't have means "any account", same as the do-not-sell count above.
  const accounts = [
    ...new Map((lots.data ?? []).map((l) => [l.accountId, l.accountName])).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const accountId = accounts.some(([id]) => id === storedAccountId) ? storedAccountId : undefined;

  // The previous plan stays up (dimmed) while the next one is worked out, instead of
  // flashing an empty grey block.
  const plan = useQuery({
    ...trpc.tax.plan.queryOptions({
      ...scope,
      targetProceeds: target ?? 0,
      doNotSell: planDoNotSell,
      accountId,
    }),
    // A saved account or holding waits for the lot list, so the plan isn't worked out twice.
    enabled:
      target !== null && target > 0 && ((!storedAccountId && !state.only) || !lots.isPending),
    placeholderData: keepPreviousData,
  });

  function toggleDoNotSell(symbol: string) {
    setState((s) => ({
      ...s,
      doNotSell: s.doNotSell.includes(symbol)
        ? s.doNotSell.filter((x) => x !== symbol)
        : [...s.doNotSell, symbol],
    }));
  }

  const typed = parseAmount(amountInput);
  function submit() {
    setState((s) => ({ ...s, target: typed }));
  }

  const d = plan.data;
  const planning = plan.isPlaceholderData && plan.isFetching;
  const edited = d !== undefined && typed !== null && typed !== target;
  const stale = edited || plan.isPlaceholderData;

  return (
    <div className="grid gap-10">
      <div className="grid gap-3">
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
              onChange={(e) => {
                const v = e.target.value;
                setState((s) => ({ ...s, amountInput: v }));
              }}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              inputMode="decimal"
              className="data w-40"
            />
            <Button onClick={submit}>Plan</Button>
          </div>
        </div>

        {only ? (
          <Button
            variant="outline"
            className="bg-accent text-primary"
            onClick={() => setState((s) => ({ ...s, only: undefined }))}
            aria-label={`Selling only ${only}. Remove to plan across every holding`}
          >
            Only {only}
            <X className="ml-1 size-3.5 opacity-60" aria-hidden />
          </Button>
        ) : (
        <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(excludedHere > 0 && "bg-accent text-primary")}
              >
                {excludedHere === 0 ? "Do-not-sell list" : `${excludedHere} excluded`}
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
        )}

        {accounts.length > 1 && (
          <div className="grid gap-1.5">
            <span id="raise-account" className="eyebrow">
              Sell from
            </span>
            <Select
              value={accountId ?? "any"}
              onValueChange={(v) =>
                setState((s) => ({ ...s, accountId: v === "any" ? undefined : v }))
              }
            >
              <SelectTrigger
                aria-labelledby="raise-account"
                className={cn("w-56", accountId && "bg-accent text-primary")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any taxable account</SelectItem>
                {accounts.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <RetirementNote tab="cash" />
      </div>

      {target === null ? null : plan.isError && !d ? (
        <TabError what="a plan" onRetry={() => void plan.refetch()} />
      ) : !d ? (
        <TabLoading label={`Planning ${fmtUsd(target)}…`} className="h-64" />
      ) : (
        <>
          {(planning || edited) && (
            <p role="status" className="-mb-6 flex items-center gap-2 text-sm text-muted-foreground">
              {planning ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Planning {fmtUsd(target)}…
                </>
              ) : (
                <>
                  Showing the plan for {fmtUsd(target)}. Press Plan to update it for{" "}
                  {fmtUsd(typed ?? 0)}.
                </>
              )}
            </p>
          )}
          <div className={cn("grid gap-10 transition-opacity", stale && "opacity-50")}>
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
                sub={
                  portfolios.length > 1 && portfolioId
                    ? `estimated, at ${activeName}'s saved rates`
                    : "estimated, at your saved rates"
                }
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
            blocked={
              only ? d.optimized.blocked.filter((b) => b.symbol === only) : d.optimized.blocked
            }
            totalProceeds={d.optimized.totalProceeds}
            shortfall={d.optimized.shortfall}
            excluded={only ? undefined : d.optimized.excluded}
            startingRealizedGain={d.startingRealizedGain}
          />
          </div>
        </>
      )}
    </div>
  );
}
