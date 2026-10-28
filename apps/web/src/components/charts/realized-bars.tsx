"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtCompactUsd, fmtUsd, useVizTheme } from "@/lib/viz";

export interface YearGains {
  year: number;
  shortTerm: number;
  longTerm: number;
  total: number;
}

/** Round ticks spanning 0 and every value, about four steps of 1/2/2.5/5 × 10^k. */
function zeroBasedTicks(values: number[]): number[] {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const raw = (hi - lo) / 4 || 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const ticks: number[] = [];
  for (let t = Math.floor(lo / step) * step; t <= Math.ceil(hi / step) * step + step / 2; t += step) {
    ticks.push(Math.round(t * 100) / 100);
  }
  return ticks;
}

/**
 * Realized gains per calendar year. Polarity encoding: gain green / loss red
 * by sign; the tooltip carries the short/long-term breakdown.
 */
export function RealizedBars({ data }: { data: YearGains[] }) {
  const theme = useVizTheme();

  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Nothing sold yet, so no gain or loss from sales.
      </p>
    );
  }

  const ticks = zeroBasedTicks(data.map((d) => d.total));

  return (
    <div className="data h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barCategoryGap="35%">
          <CartesianGrid vertical={false} stroke={theme.grid} />
          <XAxis
            dataKey="year"
            tickLine={false}
            axisLine={{ stroke: theme.baseline }}
            tick={{ fill: theme.muted, fontSize: 11 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: theme.muted, fontSize: 11 }}
            tickFormatter={(v: number) => fmtCompactUsd(v)}
            width={70}
            // bars always start at $0: with one losing year the axis ran −$229…−$233
            // and a −$230 loss drew as a floating sliver
            ticks={ticks}
            domain={[ticks[0]!, ticks[ticks.length - 1]!]}
          />
          <ReferenceLine y={0} stroke={theme.baseline} />
          <Tooltip
            cursor={{ fill: "transparent" }}
            content={({ payload, label }) => {
              const p = payload?.[0]?.payload as YearGains | undefined;
              if (!p) return null;
              return (
                <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                  <p className="font-medium">{label}</p>
                  <p className="data">
                    Total <span className="font-medium">{fmtUsd(p.total)}</span>
                  </p>
                  <p className="text-muted-foreground data">
                    Held under a year {fmtUsd(p.shortTerm)} · over a year {fmtUsd(p.longTerm)}
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.year} fill={d.total >= 0 ? theme.gain : theme.loss} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
