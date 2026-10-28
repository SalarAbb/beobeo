"use client";

import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const FILES = [
  {
    kind: "transactions",
    title: "All transactions",
    detail: "Every trade as recorded: date, units, price, fees, account",
  },
  {
    kind: "realized",
    title: "Realized gains",
    detail: "Every sale, all years (filter by its Tax year column), by the purchase it used: proceeds, cost basis, gain, term",
  },
  {
    kind: "lots",
    title: "Purchases you still hold",
    detail: "Units, cost basis, today's value and gain, when each turns long-term",
  },
] as const;

/** CSV downloads for reconciling against a broker (Transactions → Export).
 *  Plain links to /api/export, so the browser handles the download. */
export function ExportMenu({ portfolioId }: { portfolioId: string | undefined }) {
  const query = portfolioId ? `?portfolio=${portfolioId}` : "";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Download aria-hidden className="mr-1 size-4" /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="eyebrow">
          Download as CSV{portfolioId ? " · this portfolio" : ""}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {FILES.map((f) => (
          <DropdownMenuItem key={f.kind} asChild>
            <a
              href={`/api/export/${f.kind}${query}`}
              download
              // The browser's own download shelf is easy to miss; say it landed.
              onClick={() => toast.success(`Downloading ${f.title.toLowerCase()} (CSV)`, {
                description: "It's in your Downloads folder and opens in any spreadsheet.",
              })}
              className="flex flex-col items-start gap-0.5"
            >
              <span className="font-medium">{f.title}</span>
              <span className="text-xs text-muted-foreground">{f.detail}</span>
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
