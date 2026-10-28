"use client";

import {
  createChart,
  createSeriesMarkers,
  LineSeries,
  LineStyle,
  type IChartApi,
  type SeriesMarker,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { fmtUsd, useVizTheme, chartFont } from "@/lib/viz";

export interface PricePoint {
  date: string;
  close: number;
}

export interface TradeMarker {
  date: string;
  type: "buy" | "sell";
  quantity: number;
  price: number | null;
}

const toTs = (date: string) =>
  (Date.parse(`${date}T00:00:00Z`) / 1000) as UTCTimestamp;

/**
 * Price history with the user's actual buys/sells marked on the tape and a
 * dashed average-cost step line — "where you bought vs where it's been".
 */
export function PriceChart({
  prices,
  markers,
  costBasisSteps,
}: {
  prices: PricePoint[];
  markers: TradeMarker[];
  costBasisSteps: { date: string; avgCost: number }[];
}) {
  const theme = useVizTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [hover, setHover] = useState<PricePoint | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || prices.length === 0) return;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: theme.muted,
        fontSize: 11,
        fontFamily: chartFont(),
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: theme.grid },
      },
      rightPriceScale: { borderColor: theme.baseline },
      timeScale: { borderColor: theme.baseline, fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        horzLine: { visible: false, labelVisible: false },
        vertLine: { color: theme.muted, width: 1, style: LineStyle.Dashed },
      },
      localization: {
        priceFormatter: (v: number) =>
          v.toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
            notation: Math.abs(v) >= 10000 ? "compact" : "standard",
            maximumFractionDigits: Math.abs(v) >= 10000 ? 1 : 2,
          }),
      },
    });
    chartRef.current = chart;

    const priceSeries = chart.addSeries(LineSeries, {
      color: theme.series[0],
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    priceSeries.setData(prices.map((p) => ({ time: toTs(p.date), value: p.close })));

    // Average cost basis — reference line, muted + dashed, stepped.
    if (costBasisSteps.length > 0) {
      const cbSeries = chart.addSeries(LineSeries, {
        color: theme.muted,
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        lineType: 1, // steps
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      const lastPriceDate = prices[prices.length - 1]!.date;
      const stepData = costBasisSteps.map((s) => ({
        time: toTs(s.date),
        value: s.avgCost,
      }));
      // extend the final step to the right edge
      const lastStep = costBasisSteps[costBasisSteps.length - 1]!;
      if (lastStep.date < lastPriceDate) {
        stepData.push({ time: toTs(lastPriceDate), value: lastStep.avgCost });
      }
      cbSeries.setData(stepData);
    }

    // Buy/sell markers at actual trade points. Quantity labels only while
    // they can't collide — past a dozen trades they smear into noise, and
    // the open-lots/sales tables below carry the exact quantities.
    const labelled = markers.length <= 12;
    const seriesMarkers: SeriesMarker<UTCTimestamp>[] = markers.map((m) => ({
      time: toTs(m.date),
      position: m.type === "buy" ? "belowBar" : "aboveBar",
      color: m.type === "buy" ? theme.gain : theme.loss,
      shape: m.type === "buy" ? "arrowUp" : "arrowDown",
      text: labelled ? `${m.type === "buy" ? "B" : "S"} ${m.quantity}` : undefined,
      size: 1,
    }));
    createSeriesMarkers(priceSeries, seriesMarkers);

    chart.timeScale().fitContent();

    const byTime = new Map(prices.map((p) => [toTs(p.date) as number, p]));
    chart.subscribeCrosshairMove((param) => {
      setHover(param.time ? (byTime.get(param.time as number) ?? null) : null);
    });

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [prices, markers, costBasisSteps, theme]);

  const shown = hover ?? prices[prices.length - 1] ?? null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4 rounded"
            style={{ background: theme.series[0] }}
          />
          <span className="text-muted-foreground">Price</span>
          <span className="font-medium data">
            {shown ? fmtUsd(shown.close) : "—"}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-4 border-t-2 border-dashed"
            style={{ borderColor: theme.muted }}
          />
          <span className="text-muted-foreground">Your average price</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span style={{ color: theme.gain }}>▲</span>
          <span className="text-muted-foreground">Buy</span>
          <span style={{ color: theme.loss }}>▼</span>
          <span className="text-muted-foreground">Sell</span>
        </span>
        {hover && (
          <span className="text-muted-foreground data">{hover.date}</span>
        )}
      </div>
      <div ref={containerRef} className="h-80 w-full" />
    </div>
  );
}
