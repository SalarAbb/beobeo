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
import { fmtUsd } from "@/lib/viz";
import type { ExportKind, ExportSummary } from "@/server/export";

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
] as const satisfies readonly { kind: ExportKind; title: string; detail: string }[];

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const usd = (s: string | undefined) => fmtUsd(Number(s ?? 0));

/** The file's totals in words, so it can be tied to a broker statement
 *  without opening it (petyr, missions 70/71: a bare "downloading" left him
 *  no way to check the sums). */
function describe(kind: ExportKind, s: ExportSummary): string {
  if (kind === "transactions") return `${plural(s.rows, "transaction", "transactions")}. Opens in any spreadsheet.`;
  if (kind === "realized") {
    if (s.rows === 0) return "No sales recorded yet.";
    const year = s.taxableGainThisYear;
    return (
      `${plural(s.rows, "row", "rows")} (one per purchase a sale used): proceeds ${usd(s.sums.Proceeds)}, ` +
      `cost basis ${usd(s.sums["Cost basis"])}, gain ${usd(s.sums.Gain)} across all years` +
      (!year
        ? "."
        : year.rows === 0
          ? `; none of it from taxable-account sales in ${year.year}.`
          : `; ${year.year} in taxable accounts: ${usd(year.gain)} (the Tax year column).`)
    );
  }
  if (s.rows === 0) return "No purchases held.";
  return `${plural(s.rows, "purchase", "purchases")}: cost basis ${usd(s.sums["Cost basis"])}, worth ${usd(s.sums.Value)}, gain ${usd(s.sums.Gain)}.`;
}

/** Fetch an export, save it, and say in the toast what the file holds.
 *  Fetched rather than a plain link so the toast can quote the totals the
 *  server sends in `X-Export-Summary`. */
export async function downloadExport(kind: ExportKind, portfolioId: string | null | undefined) {
  const title = FILES.find((f) => f.kind === kind)!.title.toLowerCase();
  const id = toast.loading(`Preparing ${title}…`);
  try {
    const res = await fetch(`/api/export/${kind}${portfolioId ? `?portfolio=${portfolioId}` : ""}`);
    if (!res.ok) throw new Error(String(res.status));
    const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `beobeo-${kind}.csv`;
    const raw = res.headers.get("X-Export-Summary");
    const summary = raw ? (JSON.parse(decodeURIComponent(raw)) as ExportSummary) : null;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast.success(`Downloaded ${name}`, {
      id,
      description: summary ? describe(kind, summary) : "It's in your Downloads folder.",
      duration: 15_000,
    });
  } catch {
    toast.error(`Couldn't download ${title}`, {
      id,
      action: { label: "Try again", onClick: () => void downloadExport(kind, portfolioId) },
    });
  }
}

/** CSV downloads for reconciling against a broker (Transactions → Export). */
export function ExportMenu({ portfolioId }: { portfolioId: string | undefined }) {
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
          <DropdownMenuItem
            key={f.kind}
            onSelect={() => void downloadExport(f.kind, portfolioId)}
            className="flex flex-col items-start gap-0.5"
          >
            <span className="font-medium">{f.title}</span>
            <span className="text-xs text-muted-foreground">{f.detail}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
