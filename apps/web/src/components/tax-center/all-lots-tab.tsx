"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { AssetLogo } from "@/components/asset-logo";
import { usePortfolio } from "@/components/portfolio-context";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTRPC } from "@/lib/trpc";
import { fmtUsd } from "@/lib/viz";
import { cn } from "@/lib/utils";

type SortKey = "symbol" | "marketValue" | "unrealizedGain" | "openedAt";
type SortState = { key: SortKey; dir: "asc" | "desc" };

/** Module-level (not created during render) — required by the React
 *  Compiler lint; matches the dashboard's SortableHead pattern. */
function SortableHead({
  label,
  sortKey,
  sort,
  onSort,
  align = "right",
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <TableHead className={cn(align === "right" && "text-right", className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {label}
        <span aria-hidden className="w-2.5 text-[9px]">
          {active ? (sort.dir === "desc" ? "▼" : "▲") : ""}
        </span>
      </button>
    </TableHead>
  );
}

export function AllLotsTab() {
  const trpc = useTRPC();
  const { portfolioId } = usePortfolio();
  const lots = useQuery(trpc.tax.lots.queryOptions({ portfolioId: portfolioId ?? undefined }));
  const [sort, setSort] = useState<SortState>({ key: "marketValue", dir: "desc" });

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "desc" ? "asc" : "desc" }
        : { key, dir: key === "symbol" ? "asc" : "desc" },
    );
  }

  if (lots.isLoading || !lots.data) return <Skeleton className="h-96 w-full" />;

  const sorted = [...lots.data].sort((a, b) => {
    const av = sort.key === "openedAt" ? Date.parse(a.openedAt) : a[sort.key];
    const bv = sort.key === "openedAt" ? Date.parse(b.openedAt) : b[sort.key];
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : av - (bv as number);
    return sort.dir === "asc" ? cmp : -cmp;
  });

  if (sorted.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No open lots in taxable accounts.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead
                label="Asset"
                sortKey="symbol"
                sort={sort}
                onSort={toggleSort}
                align="left"
                className="pl-6"
              />
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <SortableHead label="Opened" sortKey="openedAt" sort={sort} onSort={toggleSort} />
              <TableHead className="text-right">Term</TableHead>
              <SortableHead label="Value" sortKey="marketValue" sort={sort} onSort={toggleSort} />
              <SortableHead
                label="Unrealized"
                sortKey="unrealizedGain"
                sort={sort}
                onSort={toggleSort}
                className="pr-6"
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((l) => (
              <TableRow key={l.lotId}>
                <TableCell className="pl-6">
                  <Link
                    href={`/positions/${l.assetId}`}
                    className="flex items-center gap-2.5 hover:underline"
                  >
                    <AssetLogo symbol={l.symbol} assetClass={l.assetClass} size={22} />
                    <span className="font-medium">{l.symbol}</span>
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{l.accountName}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {l.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {l.openedAt.slice(0, 10)}
                </TableCell>
                <TableCell className="text-right">
                  <span className="text-xs text-muted-foreground">
                    {l.isLongTerm ? "Long-term" : "Short-term"}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtUsd(l.marketValue)}</TableCell>
                <TableCell
                  className={cn(
                    "pr-6 text-right tabular-nums",
                    l.unrealizedGain >= 0 ? "text-gain" : "text-loss",
                  )}
                >
                  {fmtUsd(l.unrealizedGain)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
