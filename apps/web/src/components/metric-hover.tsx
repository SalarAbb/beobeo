"use client";

import { Ruler } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The layman-first metric explanation (R-002): the trigger shows only a plain
 * label (and maybe the value); hovering, focusing or tapping it opens a compact
 * card — tiny `LABEL · TERM` header → bold takeaway that reads the user's own
 * number → one muted sentence of meaning → a yardstick footer. Used by the
 * dashboard's Performance details and Compare's head-to-head table.
 *
 * A plain Radix tooltip never opens on a tap, which left phone users with an
 * unexplained "Swings" label; the open state is controlled so a click opens it.
 * Needs a `TooltipProvider` above it.
 */
export function MetricHover({
  label,
  term,
  insight,
  meaning,
  yardstick,
  children,
  className,
}: {
  label: string;
  term?: string;
  /** One-line reading of the user's own number ("fair reward for the risk"). */
  insight: string;
  meaning: string;
  yardstick: string;
  /** The trigger's content. */
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          // preventDefault skips Radix's own click handler, which closes it.
          // A tap or click opens; a tap elsewhere dismisses.
          onClick={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
          className={cn("cursor-help text-left", className)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="w-64 p-0">
        <div className="px-3.5 pt-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
            {term && <span className="opacity-60"> · {term}</span>}
          </p>
          <p className="mt-1 text-sm font-semibold leading-snug">{insight}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{meaning}</p>
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 border-t px-3.5 py-2 text-[11px] text-muted-foreground">
          <Ruler aria-hidden className="size-3 shrink-0 opacity-60" />
          {yardstick}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/** The dotted underline that marks a label as explainable. */
export const METRIC_LABEL_CLASS =
  "underline decoration-muted-foreground/40 decoration-dotted underline-offset-4";
