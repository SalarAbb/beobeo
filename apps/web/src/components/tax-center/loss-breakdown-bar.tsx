"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fmtUsd, useVizTheme } from "@/lib/viz";

interface Breakdown {
  totalHarvestedLossUsd: number;
  gainsOffsetUsd: number;
  ordinaryDeductionUsd: number;
  carryforwardUsd: number;
}

/**
 * Segmented horizontal bar showing where the harvested loss actually goes —
 * "cancels out gains you already have" first, then the $3,000 ordinary
 * deduction, then whatever's left over just carries forward (worth less,
 * since it's deferred and uncertain). Fixed categorical hue order (never by
 * rank), 2px gaps between segments per the dataviz convention used
 * throughout this app.
 */
export function LossBreakdownBar({ breakdown }: { breakdown: Breakdown }) {
  const theme = useVizTheme();
  const total = breakdown.totalHarvestedLossUsd;
  if (total <= 0.5) return null;

  const segments = [
    {
      key: "offset",
      label: "Cancels out gains you already have",
      value: breakdown.gainsOffsetUsd,
      color: theme.series[0],
      detail:
        "This part offsets gains you'd otherwise be taxed on this year, dollar for dollar, at your full rate.",
    },
    {
      key: "deduction",
      label: "$3,000 ordinary-income deduction",
      value: breakdown.ordinaryDeductionUsd,
      color: theme.series[2],
      detail:
        "Once there's no more gain left to offset, the next $3,000 of loss directly reduces your taxable ordinary income — the annual federal cap.",
    },
    {
      key: "carryforward",
      label: "Carries forward to future years",
      value: breakdown.carryforwardUsd,
      color: theme.series[4],
      detail:
        "Beyond the $3,000 cap, a loss doesn't help this year's taxes — it carries forward to offset future gains. Real value, just deferred and discounted here to reflect that.",
    },
  ].filter((s) => s.value > 0.5);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="grid gap-2.5">
        <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
          {segments.map((s) => (
            <Tooltip key={s.key}>
              <TooltipTrigger asChild>
                <div
                  className="h-full cursor-help first:rounded-l-full last:rounded-r-full"
                  style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-64 p-2.5 text-xs">
                <p className="font-semibold">
                  {s.label} — {fmtUsd(s.value)}
                </p>
                <p className="mt-1 text-muted-foreground">{s.detail}</p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {segments.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5 text-xs">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: s.color }}
              />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="font-medium data">{fmtUsd(s.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
