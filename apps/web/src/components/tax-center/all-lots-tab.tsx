"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { AssetLogo } from "@/components/asset-logo";
import { usePortfolio } from "@/components/portfolio-context";
import { TabError, TabLoading } from "@/components/tax-center/tab-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTRPC } from "@/lib/trpc";
import { fmtUsd, gainClass } from "@/lib/viz";
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

  if (lots.isError && !lots.data)
    return <TabError what="your purchases" onRetry={() => void lots.refetch()} />;
  if (!lots.data) return <TabLoading label="Loading your purchases…" className="h-96" />;

  const sorted = [...lots.data].sort((a, b) => {
    const av = sort.key === "openedAt" ? Date.parse(a.openedAt) : a[sort.key];
    const bv = sort.key === "openedAt" ? Date.parse(b.openedAt) : b[sort.key];
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : av - (bv as number);
    return sort.dir === "asc" ? cmp : -cmp;
  });

  if (sorted.length === 0) {
    return (
      <p className="border-y py-12 text-center text-sm text-muted-foreground">
        Nothing here: you have no holdings in taxable accounts (retirement accounts
        aren&apos;t taxed when you sell).
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Every batch of shares you bought, listed separately. Each has its own price paid and
        holding time, and that is what decides the tax when you sell it. Shares you already
        sold are on{" "}
        <Link href="/transactions" className="text-primary hover:underline">
          Transactions
        </Link>
        : tap a sale to see the purchases it used and its gain.
      </p>
      <div className="min-w-0 border-t">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortableHead
                label="Asset"
                sortKey="symbol"
                sort={sort}
                onSort={toggleSort}
                align="left"
                className="pl-1"
              />
              <TableHead className="hidden md:table-cell">Account</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Qty</TableHead>
              <SortableHead label="Bought" sortKey="openedAt" sort={sort} onSort={toggleSort} />
              <TableHead className="hidden text-right sm:table-cell">Held</TableHead>
              <SortableHead label="Value" sortKey="marketValue" sort={sort} onSort={toggleSort} />
              <SortableHead
                label="Gain if sold"
                sortKey="unrealizedGain"
                sort={sort}
                onSort={toggleSort}
                className="pr-1"
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((l) => (
              <TableRow key={l.lotId}>
                <TableCell className="pl-1">
                  <Link
                    href={`/positions/${l.assetId}`}
                    className="flex items-center gap-2.5 hover:underline"
                  >
                    <AssetLogo symbol={l.symbol} assetClass={l.assetClass} size={22} />
                    <span className="font-medium">{l.symbol}</span>
                  </Link>
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {l.accountName}
                </TableCell>
                <TableCell className="hidden text-right data text-[13px] sm:table-cell">
                  {l.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right data text-[13px] text-muted-foreground">
                  {l.openedAt.slice(0, 10)}
                </TableCell>
                <TableCell className="hidden text-right sm:table-cell">
                  <span className="text-xs text-muted-foreground">
                    {l.isLongTerm ? "over a year" : "under a year"}
                  </span>
                </TableCell>
                <TableCell className="text-right data text-[13px]">
                  {fmtUsd(l.marketValue)}
                </TableCell>
                <TableCell
                  className={cn("pr-1 text-right data text-[13px]", gainClass(l.unrealizedGain))}
                >
                  {fmtUsd(l.unrealizedGain)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
