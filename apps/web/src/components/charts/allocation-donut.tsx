"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { fmtUsd, useVizTheme, type VizTheme } from "@/lib/viz";

export interface AllocationSlice {
  symbol: string;
  value: number;
}

const MAX_SLICES = 7; // 7 named + "Other" keeps within the 8-slot palette

/**
 * The donut's slices (top 7 + "Other") and their colors. Hue slots are
 * assigned by stable symbol order (alphabetical), so a holding keeps its
 * color as the portfolio changes — color follows the entity, never its rank.
 * Exported so the target-mix table dots each row in its slice's color
 * (anything folded into "Other", or not held, gets the muted gray).
 */
export function allocationSlices(data: AllocationSlice[], theme: VizTheme) {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, MAX_SLICES);
  const rest = sorted.slice(MAX_SLICES);
  const slices = [...top];
  if (rest.length > 0) {
    slices.push({ symbol: "Other", value: rest.reduce((s, d) => s + d.value, 0) });
  }

  // stable hue assignment: alphabetical symbol order → palette slot
  const hueOrder = [...slices.map((s) => s.symbol)].sort();
  const colorFor = (symbol: string) =>
    symbol === "Other" || !hueOrder.includes(symbol)
      ? theme.muted
      : theme.series[hueOrder.indexOf(symbol) % theme.series.length]!;
  return { slices, colorFor };
}

/** Allocation donut with direct labels; `legend={false}` when a table next
 *  to it already names every slice. */
export function AllocationDonut({
  data,
  legend = true,
}: {
  data: AllocationSlice[];
  legend?: boolean;
}) {
  const theme = useVizTheme();
  const total = data.reduce((s, d) => s + d.value, 0);
  const { slices, colorFor } = allocationSlices(data, theme);

  if (total === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No priced holdings yet
      </p>
    );
  }

  return (
    // Wrap, don't overflow: in a narrow card the legend drops below the donut
    // instead of spilling past the card edge.
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
      <div className="h-44 w-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="symbol"
              innerRadius="62%"
              outerRadius="100%"
              paddingAngle={2}
              stroke="none"
              isAnimationActive={false}
            >
              {slices.map((s) => (
                <Cell key={s.symbol} fill={colorFor(s.symbol)} />
              ))}
            </Pie>
            <Tooltip
              content={({ payload }) => {
                const p = payload?.[0];
                if (!p) return null;
                const v = p.value as number;
                return (
                  <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                    <span className="font-medium">{p.name}</span>{" "}
                    <span className="data">{fmtUsd(v)}</span>{" "}
                    <span className="text-muted-foreground data">
                      ({((v / total) * 100).toFixed(1)}%)
                    </span>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {/* direct labels — the relief for sub-3:1 light-mode slots */}
      {legend && (
        <ul className="grid gap-1.5 text-xs">
          {slices.map((s) => (
            <li key={s.symbol} className="flex items-center gap-2">
              <span
                className="size-2.5 rounded-[3px]"
                style={{ background: colorFor(s.symbol) }}
              />
              <span className="w-14 font-medium">{s.symbol}</span>
              <span className="data text-muted-foreground">
                {((s.value / total) * 100).toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
