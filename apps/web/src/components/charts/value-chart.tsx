"use client";

import {
  AreaSeries,
  createChart,
  LineSeries,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fmtCompactUsd, fmtUsd, useVizTheme } from "@/lib/viz";
import { cn } from "@/lib/utils";

export interface ValuePoint {
  date: string;
  value: number;
  invested: number;
}

const RANGES = [
  { key: "1M", days: 31 },
  { key: "3M", days: 92 },
  { key: "YTD", days: null },
  { key: "1Y", days: 366 },
  { key: "ALL", days: Infinity },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

const toTs = (date: string) =>
  (Date.parse(`${date}T00:00:00Z`) / 1000) as UTCTimestamp;

export function ValueChart({ data }: { data: ValuePoint[] }) {
  const theme = useVizTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [range, setRange] = useState<RangeKey>("ALL");
  const [hover, setHover] = useState<ValuePoint | null>(null);

  const sliced = useMemo(() => {
    // Ranges are relative to the latest data point (pure — no clock reads).
    const lastDate = data[data.length - 1]?.date;
    if (range === "ALL" || !lastDate) return data;
    if (range === "YTD") {
      const jan1 = `${lastDate.slice(0, 4)}-01-01`;
      return data.filter((p) => p.date >= jan1);
    }
    const days = RANGES.find((r) => r.key === range)!.days as number;
    const cutoff = new Date(Date.parse(`${lastDate}T00:00:00Z`) - days * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return data.filter((p) => p.date >= cutoff);
  }, [data, range]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || sliced.length === 0) return;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: theme.muted,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: theme.grid, style: LineStyle.Solid },
      },
      rightPriceScale: { borderColor: theme.baseline },
      timeScale: { borderColor: theme.baseline, fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        horzLine: { visible: false, labelVisible: false },
        vertLine: { color: theme.muted, width: 1, style: LineStyle.Dashed },
      },
      localization: {
        priceFormatter: (v: number) => fmtCompactUsd(v),
      },
    });
    chartRef.current = chart;

    const valueSeries = chart.addSeries(AreaSeries, {
      lineColor: theme.series[0],
      lineWidth: 2,
      topColor: theme.areaTop,
      bottomColor: theme.areaBottom,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    valueSeries.setData(sliced.map((p) => ({ time: toTs(p.date), value: p.value })));

    const investedSeries = chart.addSeries(LineSeries, {
      color: theme.muted,
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    investedSeries.setData(
      sliced.map((p) => ({ time: toTs(p.date), value: p.invested })),
    );

    chart.timeScale().fitContent();

    const byTime = new Map(sliced.map((p) => [toTs(p.date) as number, p]));
    chart.subscribeCrosshairMove((param) => {
      setHover(param.time ? (byTime.get(param.time as number) ?? null) : null);
    });

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [sliced, theme]);

  const last = sliced[sliced.length - 1];
  const shown = hover ?? last;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-4 rounded"
              style={{ background: theme.series[0] }}
            />
            <span className="text-muted-foreground">Value</span>
            <span className="font-medium tabular-nums">
              {shown ? fmtUsd(shown.value) : "—"}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-4 border-t-2 border-dashed"
              style={{ borderColor: theme.muted }}
            />
            <span className="text-muted-foreground">Invested</span>
            <span className="font-medium tabular-nums">
              {shown ? fmtUsd(shown.invested) : "—"}
            </span>
          </span>
          {hover && (
            <span className="text-muted-foreground tabular-nums">{hover.date}</span>
          )}
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Button
              key={r.key}
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 px-2 text-xs",
                range === r.key && "bg-secondary font-semibold",
              )}
              onClick={() => setRange(r.key)}
            >
              {r.key}
            </Button>
          ))}
        </div>
      </div>
      <div ref={containerRef} className="h-72 w-full" />
    </div>
  );
}
