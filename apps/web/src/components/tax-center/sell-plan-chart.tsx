"use client";

import { AssetLogo } from "@/components/asset-logo";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fmtUsd, gainClass, useVizTheme } from "@/lib/viz";

interface SaleLike {
  lot: { symbol: string; assetClass: string; accountName: string; assetId: string };
  sellQuantity: number;
  proceeds: number;
  realizedGain: number;
  isLongTerm: boolean;
  taxCost: number;
  netAfterTax: number;
}

const CHART_H = 250;
const PLOT_TOP = 14;
const PLOT_BOTTOM = 14;
/** Width of the left y-axis gutter (value ticks + zone labels). */
const AXIS_W = 96;
const PLOT_RIGHT = 20;

/** Signed USD, always with a leading +/− so gains vs losses are unmistakable. */
const fmtSigned = (v: number) => `${v >= 0 ? "+" : "−"}${fmtUsd(Math.abs(v))}`;

/**
 * The plan as a capital-gains waterfall on a tax "map". The y-axis is total
 * realized capital gains for the year: everything ABOVE the $0 line is the
 * green "capital gains" zone (you'd owe tax), everything BELOW is the red
 * "capital losses" zone (a tax benefit), and the $0 line itself is the
 * no-tax break-even. The waterfall starts at where you are NOW
 * (`startingRealizedGain` = YTD realized), each column is one symbol's
 * cumulative step, and it ends at where you'll be AFTER the plan. The
 * tinted zones give the "empty" space meaning — you can see at a glance
 * whether the plan keeps you in gains or pushes you into losses.
 *
 * Per-symbol labels show each stock's OWN net (not the running total) — the
 * bars carry the cumulative story, the labels carry the individual one.
 * One bar per symbol (its NET across all its lots), never sub-stacked;
 * individual lots live in the hover tooltip.
 */
export function SellPlanChart({
  sales,
  startingRealizedGain = 0,
  cashRaised,
}: {
  sales: SaleLike[];
  startingRealizedGain?: number;
  cashRaised?: number;
}) {
  const theme = useVizTheme();
  if (sales.length === 0) return null;

  // Group by symbol, preserving first-appearance (real sell) order.
  const order: string[] = [];
  const groups = new Map<string, SaleLike[]>();
  for (const s of sales) {
    let g = groups.get(s.lot.symbol);
    if (!g) {
      g = [];
      groups.set(s.lot.symbol, g);
      order.push(s.lot.symbol);
    }
    g.push(s);
  }

  let cumulative = startingRealizedGain;
  const columns = order.map((symbol) => {
    const lots = groups.get(symbol)!;
    const colStart = cumulative;
    const net = lots.reduce((s, l) => s + l.realizedGain, 0);
    cumulative += net;
    return { symbol, assetClass: lots[0]!.lot.assetClass, lots, colStart, colEnd: cumulative, net };
  });
  const endPos = cumulative;

  // Domain always straddles $0 so BOTH zones (gains above, losses below) are
  // visible — with a guaranteed sliver of the side that has no data, so a
  // plan that stays entirely in gains still shows the red loss zone beneath.
  const cumPoints = [startingRealizedGain, ...columns.map((c) => c.colEnd)];
  const dataTop = Math.max(...cumPoints);
  const dataBottom = Math.min(...cumPoints);
  let top = Math.max(dataTop, 0);
  let bottom = Math.min(dataBottom, 0);
  const sliver = Math.max(top - bottom, 1) * 0.16;
  top = Math.max(top, sliver);
  bottom = Math.min(bottom, -sliver);
  const padY = (top - bottom) * 0.05;
  const domainMax = top + padY;
  const domainMin = bottom - padY;
  const plotH = CHART_H - PLOT_TOP - PLOT_BOTTOM;
  const yToPx = (v: number) =>
    PLOT_TOP + ((domainMax - v) / (domainMax - domainMin)) * plotH;

  const zeroPx = yToPx(0);
  const nowIsZero = Math.abs(startingRealizedGain) < 0.5;
  const plotStyle = { paddingLeft: AXIS_W, paddingRight: PLOT_RIGHT };

  // A dashed reference line across the plot area (not the gutter), with its
  // value tick shown in the gutter at the same height.
  const refLine = (value: number, tick: string, color?: string) => (
    <>
      <div
        className="absolute border-t border-dashed"
        style={{ top: yToPx(value), left: AXIS_W, right: 0, borderColor: color ?? theme.baseline }}
      />
      <span
        className="absolute -translate-y-1/2 text-right text-[10px] font-medium data"
        style={{ top: yToPx(value), left: 22, width: AXIS_W - 28, color: color ?? undefined }}
      >
        {tick}
      </span>
    </>
  );

  return (
    <TooltipProvider delayDuration={150}>
      <div className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-sm">
          <div className="text-muted-foreground">
            Realized gains this year:{" "}
            <span
              className={`font-medium ${nowIsZero ? "text-foreground" : gainClass(startingRealizedGain)}`}
            >
              {nowIsZero ? "$0" : fmtSigned(startingRealizedGain)}
            </span>{" "}
            now <span aria-hidden>→</span>{" "}
            <span className={`font-semibold ${gainClass(endPos)}`}>{fmtSigned(endPos)}</span>{" "}
            after this plan
          </div>
          {cashRaised !== undefined && (
            <div className="text-muted-foreground">
              Cash raised{" "}
              <span className="font-semibold text-foreground">{fmtUsd(cashRaised)}</span>
            </div>
          )}
        </div>

        <div className="relative overflow-hidden rounded-lg" style={{ height: CHART_H }}>
          {/* Zone tints: green above $0 (capital gains), red below (losses). */}
          <div
            className="absolute inset-x-0 top-0"
            style={{ height: zeroPx, background: theme.gain, opacity: 0.08 }}
          />
          <div
            className="absolute inset-x-0 bottom-0"
            style={{ top: zeroPx, background: theme.loss, opacity: 0.08 }}
          />

          {/* Vertical zone labels in the far-left gutter (only when the zone
              is tall enough to read). */}
          {zeroPx > 54 && (
            <span
              className="absolute left-1.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{
                top: zeroPx / 2,
                transform: "translateY(-50%)",
                writingMode: "vertical-rl",
                color: theme.gain,
              }}
            >
              Capital gains
            </span>
          )}
          {CHART_H - zeroPx > 54 && (
            <span
              className="absolute left-1.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{
                top: (zeroPx + CHART_H) / 2,
                transform: "translateY(-50%)",
                writingMode: "vertical-rl",
                color: theme.loss,
              }}
            >
              Capital losses
            </span>
          )}

          {/* $0 break-even line + tick */}
          <div
            className="absolute inset-x-0 border-t"
            style={{ top: zeroPx, borderColor: theme.baseline }}
          />
          <div
            className="absolute -translate-y-1/2 text-right"
            style={{ top: zeroPx, left: 22, width: AXIS_W - 28 }}
          >
            <div className="text-[11px] font-semibold data">$0</div>
            <div className="text-[9px] leading-tight text-muted-foreground">
              {nowIsZero ? "now · no tax" : "no tax"}
            </div>
          </div>

          {/* Now (start) and After (end) reference lines */}
          {!nowIsZero && refLine(startingRealizedGain, `Now ${fmtSigned(startingRealizedGain)}`)}
          {refLine(endPos, `After ${fmtSigned(endPos)}`, endPos >= 0 ? theme.gain : theme.loss)}

          {/* Bars */}
          <div className="absolute inset-0 flex items-stretch gap-1.5" style={plotStyle}>
            {columns.map((col) => {
              const barTop = yToPx(Math.max(col.colStart, col.colEnd));
              const barBottom = yToPx(Math.min(col.colStart, col.colEnd));
              const height = Math.max(barBottom - barTop, 3);
              const isGain = col.net >= 0;
              const multiLot = col.lots.length > 1;
              return (
                <div key={col.symbol} className="relative min-w-0 flex-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className="absolute inset-x-0 cursor-help rounded-[2px] opacity-90 transition-opacity hover:opacity-100"
                        style={{ top: barTop, height, background: isGain ? theme.gain : theme.loss }}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-64 p-2.5 text-xs">
                      <p className="font-semibold">
                        {col.symbol} · {fmtSigned(col.net)} realized
                      </p>
                      <div className="mt-1 grid gap-1">
                        {col.lots.map((l, i) => (
                          <div key={i} className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">
                              {l.sellQuantity.toLocaleString(undefined, {
                                maximumFractionDigits: 6,
                              })}{" "}
                              · {l.lot.accountName} · {l.isLongTerm ? "LT" : "ST"}
                            </span>
                            <span className={gainClass(l.realizedGain)}>
                              {fmtSigned(l.realizedGain)}
                            </span>
                          </div>
                        ))}
                      </div>
                      {multiLot && (
                        <div className="mt-1.5 flex items-center justify-between gap-3 border-t pt-1.5 font-medium">
                          <span>Net</span>
                          <span className={gainClass(col.net)}>{fmtSigned(col.net)}</span>
                        </div>
                      )}
                      <p className="mt-1.5 text-muted-foreground">
                        {fmtUsd(col.lots.reduce((s, l) => s + l.proceeds, 0))} cash · running
                        total {fmtSigned(col.colEnd)}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        </div>

        {/* Per-symbol table: header (logo+symbol), then a gain/loss row and a
            cash-raised row. Columns align 1:1 with the bars above; the left
            gutter carries the row labels, mirroring the chart's y-axis. */}
        <div className="overflow-hidden rounded-lg border">
          <div className="flex items-center border-b bg-secondary/30 py-2.5">
            <div className="shrink-0" style={{ width: AXIS_W }} />
            <div className="flex flex-1 gap-1.5" style={{ paddingRight: PLOT_RIGHT }}>
              {columns.map((col) => (
                <div
                  key={col.symbol}
                  className="flex min-w-0 flex-1 flex-col items-center gap-1"
                >
                  <AssetLogo symbol={col.symbol} assetClass={col.assetClass} size={20} />
                  <span className="truncate text-[11px] font-medium">{col.symbol}</span>
                </div>
              ))}
            </div>
          </div>

          {(
            [
              {
                key: "gl",
                label: "Gain / loss",
                cell: (col: (typeof columns)[number]) => (
                  <span className={`data ${gainClass(col.net)}`}>
                    {fmtSigned(col.net)}
                  </span>
                ),
              },
              {
                key: "units",
                label: "Units to sell",
                cell: (col: (typeof columns)[number]) => (
                  <span className="data text-foreground">
                    {col.lots
                      .reduce((s, l) => s + l.sellQuantity, 0)
                      .toLocaleString(undefined, { maximumFractionDigits: 6 })}
                  </span>
                ),
              },
              {
                key: "cash",
                label: "Cash raised",
                cell: (col: (typeof columns)[number]) => (
                  <span className="data text-foreground">
                    {fmtUsd(col.lots.reduce((s, l) => s + l.proceeds, 0))}
                  </span>
                ),
              },
            ] as const
          ).map((row, i) => (
            <div
              key={row.key}
              className={`flex items-center py-2 ${i > 0 ? "border-t" : ""}`}
            >
              <div
                className="shrink-0 pr-3 text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                style={{ width: AXIS_W }}
              >
                {row.label}
              </div>
              <div className="flex flex-1 gap-1.5" style={{ paddingRight: PLOT_RIGHT }}>
                {columns.map((col) => (
                  <div
                    key={col.symbol}
                    className="min-w-0 flex-1 truncate text-center text-xs"
                  >
                    {row.cell(col)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
