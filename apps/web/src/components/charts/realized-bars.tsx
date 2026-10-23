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

/**
 * Realized gains per calendar year. Polarity encoding: gain green / loss red
 * by sign; the tooltip carries the short/long-term breakdown.
 */
export function RealizedBars({ data }: { data: YearGains[] }) {
  const theme = useVizTheme();

  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No realized gains yet — nothing has been sold.
      </p>
    );
  }

  return (
    <div className="h-56 w-full">
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
                  <p className="tabular-nums">
                    Total <span className="font-medium">{fmtUsd(p.total)}</span>
                  </p>
                  <p className="text-muted-foreground tabular-nums">
                    Short-term {fmtUsd(p.shortTerm)} · Long-term {fmtUsd(p.longTerm)}
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
