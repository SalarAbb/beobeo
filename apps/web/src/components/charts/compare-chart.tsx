"use client";

import {
  createChart,
  LineSeries,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { fmtCompactUsd, fmtUsd, useVizTheme, type VizTheme, chartFont } from "@/lib/viz";

export interface ComparePoint {
  date: string;
  value: number;
  invested: number;
}

export interface BenchmarkSeries {
  label: string;
  series: ComparePoint[];
}

const toTs = (date: string) =>
  (Date.parse(`${date}T00:00:00Z`) / 1000) as UTCTimestamp;

/** Benchmark hues: validated categorical slots, portfolio keeps slot 1 (blue). */
export const benchColor = (theme: VizTheme, i: number) =>
  [theme.series[2], theme.series[1], theme.series[4], theme.series[7]][i % 4]!;

/**
 * Your (possibly scoped) portfolio vs 1–4 DCA-replayed benchmarks — same
 * dollars, same dates. Solid lines per series + shared invested baseline.
 */
export function CompareChart({
  portfolio,
  benchmarks,
  portfolioLabel = "Your portfolio",
}: {
  portfolio: ComparePoint[];
  benchmarks: BenchmarkSeries[];
  portfolioLabel?: string;
}) {
  const theme = useVizTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [hover, setHover] = useState<{
    date: string;
    portfolio: number | null;
    bench: (number | null)[];
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || portfolio.length === 0) return;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: theme.muted,
        fontSize: 11,
        fontFamily: chartFont(),
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: theme.grid } },
      rightPriceScale: { borderColor: theme.baseline },
      timeScale: { borderColor: theme.baseline, fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        horzLine: { visible: false, labelVisible: false },
        vertLine: { color: theme.muted, width: 1, style: LineStyle.Dashed },
      },
      localization: { priceFormatter: (v: number) => fmtCompactUsd(v) },
    });
    chartRef.current = chart;

    const portfolioSeries = chart.addSeries(LineSeries, {
      color: theme.series[0],
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    portfolioSeries.setData(
      portfolio.map((p) => ({ time: toTs(p.date), value: p.value })),
    );

    benchmarks.forEach((b, i) => {
      const s = chart.addSeries(LineSeries, {
        color: benchColor(theme, i),
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      s.setData(b.series.map((p) => ({ time: toTs(p.date), value: p.value })));
    });

    const investedSeries = chart.addSeries(LineSeries, {
      color: theme.muted,
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    investedSeries.setData(
      portfolio.map((p) => ({ time: toTs(p.date), value: p.invested })),
    );

    chart.timeScale().fitContent();

    const pByTime = new Map(portfolio.map((p) => [toTs(p.date) as number, p]));
    const bByTime = benchmarks.map(
      (b) => new Map(b.series.map((p) => [toTs(p.date) as number, p])),
    );
    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setHover(null);
        return;
      }
      const t = param.time as number;
      const p = pByTime.get(t);
      setHover({
        date: p?.date ?? "",
        portfolio: p?.value ?? null,
        bench: bByTime.map((m) => m.get(t)?.value ?? null),
      });
    });

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [portfolio, benchmarks, theme]);

  const lastP = portfolio[portfolio.length - 1];

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4 rounded"
            style={{ background: theme.series[0] }}
          />
          <span className="text-muted-foreground">{portfolioLabel}</span>
          <span className="font-medium data">
            {fmtUsd(hover ? hover.portfolio : (lastP?.value ?? null))}
          </span>
        </span>
        {benchmarks.map((b, i) => {
          const last = b.series[b.series.length - 1];
          return (
            <span key={b.label} className="flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4 rounded"
                style={{ background: benchColor(theme, i) }}
              />
              <span className="text-muted-foreground">{b.label}</span>
              <span className="font-medium data">
                {fmtUsd(hover ? hover.bench[i] : (last?.value ?? null))}
              </span>
            </span>
          );
        })}
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-4 border-t-2 border-dashed"
            style={{ borderColor: theme.muted }}
          />
          <span className="text-muted-foreground">Put in, minus sales</span>
        </span>
        {hover && (
          <span className="data text-muted-foreground">{hover.date}</span>
        )}
      </div>
      <div ref={containerRef} className="h-80 w-full" />
    </div>
  );
}
