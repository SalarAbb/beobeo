"use client";

import { AlertTriangle, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SellPlanChart } from "@/components/tax-center/sell-plan-chart";
import { fmtUsd } from "@/lib/viz";
import { cn } from "@/lib/utils";

interface Lot {
  symbol: string;
  assetClass: string;
  accountName: string;
  assetId: string;
}
interface Sale {
  lot: Lot;
  sellQuantity: number;
  proceeds: number;
  realizedGain: number;
  isLongTerm: boolean;
  taxCost: number;
  netAfterTax: number;
  ripening: { daysUntilLongTerm: number; estSavingsIfWaited: number } | null;
}
interface Block {
  symbol: string;
  disallowedLossUsd: number;
  permanentlyDisallowed: boolean;
  reason: string;
}
interface Excluded {
  lot: Lot;
  reason: string;
}

/**
 * Shared plan renderer — used by both Raise Cash and Harvest Losses.
 *
 * Deliberately NOT a wall of per-lot columns: the two things that matter are
 * *what to sell, in what order* (the chart's x-axis, real sell order) and
 * *the cumulative effect as you go* (the chart's y-axis, running realized
 * gain/loss). Per-lot dollar detail — proceeds, tax cost, net after tax —
 * lives in the chart's hover tooltip, available on demand rather than
 * printed by default for every row.
 */
export function PlanView({
  sales,
  blocked,
  shortfall,
  totalProceeds,
  excluded,
  startingRealizedGain,
}: {
  sales: Sale[];
  blocked: Block[];
  shortfall?: number;
  totalProceeds: number;
  excluded?: Excluded[];
  /** Realized capital gains so far this year — the waterfall's starting point. */
  startingRealizedGain?: number;
}) {
  return (
    <div className="grid gap-4">
      {shortfall !== undefined && shortfall > 0.5 && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-muted-foreground">
          These lots can only raise {fmtUsd(totalProceeds)} — {fmtUsd(shortfall)} short of
          your target. There isn&apos;t enough eligible, unblocked value to sell.
        </p>
      )}

      {sales.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <SellPlanChart
              sales={sales}
              startingRealizedGain={startingRealizedGain}
              cashRaised={totalProceeds}
            />
          </CardContent>
        </Card>
      )}

      {blocked.length > 0 && (
        <div className="grid gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <AlertTriangle className="size-3.5" /> Blocked by the wash-sale rule
          </p>
          {blocked.map((b, i) => (
            <div
              key={`${b.symbol}-${i}`}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-xs leading-relaxed",
                b.permanentlyDisallowed
                  ? "border-destructive/30 bg-destructive/5"
                  : "border-border bg-secondary/40 text-muted-foreground",
              )}
            >
              <span className="font-medium text-foreground">
                {b.symbol} — {fmtUsd(b.disallowedLossUsd)} loss
                {b.permanentlyDisallowed ? " permanently disallowed" : " deferred"}.
              </span>{" "}
              {b.reason}
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">
            Different fund tracking the same index? The IRS hasn&apos;t defined
            &quot;substantially identical&quot; for similar-but-different funds — we can&apos;t
            tell you that&apos;s safe either.
          </p>
        </div>
      )}

      {excluded && excluded.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Skipped (on your do-not-sell list): {excluded.map((e) => e.lot.symbol).join(", ")}
        </p>
      )}

      {sales.length === 0 && blocked.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <TrendingDown className="size-5" />
            Nothing to show yet.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
