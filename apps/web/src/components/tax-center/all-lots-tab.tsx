"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { AssetLogo } from "@/components/asset-logo";
import { usePortfolio } from "@/components/portfolio-context";
import { TabError, TabLoading } from "@/components/tax-center/tab-state";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useStoredState } from "@/lib/use-stored-state";
import { useTRPC } from "@/lib/trpc";
import { fmtPct, fmtUsd, gainClass } from "@/lib/viz";
import { cn } from "@/lib/utils";

type SortKey = "symbol" | "costBasis" | "marketValue" | "unrealizedGain" | "openedAt";
type SortState = { key: SortKey; dir: "asc" | "desc" };

const ALL = "__all";

type Show = typeof ALL | "gains" | "losses";
const SHOW_OPTIONS: { value: Show; label: string }[] = [
  { value: ALL, label: "Gains and losses" },
  { value: "gains", label: "Gains" },
  { value: "losses", label: "Losses" },
];

/** A typed "$500" / "1,000" → a positive dollar floor, else null (no floor). */
function parseFloor(input: string): number | null {
  const n = Number(input.replace(/[^0-9.]/g, ""));
  return input.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
}

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

/** Per-unit prices: cents from $1, four significant figures below (small coins aren't $0.00). */
const fmtUnitPrice = (v: number) =>
  Math.abs(v) >= 1
    ? fmtUsd(v)
    : v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumSignificantDigits: 4 });

/** Gain as a share of what was paid; null for a zero-cost purchase (e.g. a transfer with no price). */
const gainPct = (gain: number, cost: number) => (cost > 0 ? (gain / cost) * 100 : null);

const fmtUnits = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 6 });

export function AllLotsTab() {
  const trpc = useTRPC();
  const { portfolioId } = usePortfolio();
  const lots = useQuery(trpc.tax.lots.queryOptions({ portfolioId: portfolioId ?? undefined }));
  const [assetFilter, setAssetFilter] = useStoredState<string>("beobeo.tax.lots.asset", ALL);
  // Gains or losses only, with a dollar floor ("losses over $500", hermione).
  const [{ show, overInput }, setShowState] = useStoredState<{ show: Show; overInput: string }>(
    "beobeo.tax.lots.show",
    { show: ALL, overInput: "" },
  );
  // null = the default for what's shown: biggest loss or gain first, else largest value.
  const [sortPick, setSort] = useState<SortState | null>(null);
  const sort: SortState =
    sortPick ??
    (show === ALL
      ? { key: "marketValue", dir: "desc" }
      : { key: "unrealizedGain", dir: show === "losses" ? "asc" : "desc" });

  function pickShow(next: Show) {
    setShowState((s) => ({ ...s, show: next }));
    setSort(null);
  }

  function toggleSort(key: SortKey) {
    setSort(
      sort.key === key
        ? { key, dir: sort.dir === "desc" ? "asc" : "desc" }
        : { key, dir: key === "symbol" ? "asc" : "desc" },
    );
  }

  if (lots.isError && !lots.data)
    return <TabError what="your purchases" onRetry={() => void lots.refetch()} />;
  if (!lots.data) return <TabLoading label="Loading your purchases…" className="h-96" />;

  if (lots.data.length === 0) {
    return (
      <p className="border-y py-12 text-center text-sm text-muted-foreground">
        Nothing here: you have no holdings in taxable accounts (retirement accounts
        aren&apos;t taxed when you sell).
      </p>
    );
  }

  // Assets in this scope, alphabetical; a remembered pick this scope doesn't hold shows everything.
  const symbols = [...new Set(lots.data.map((l) => l.symbol))].sort();
  const filter = symbols.includes(assetFilter) ? assetFilter : ALL;
  const ofAsset = filter === ALL ? lots.data : lots.data.filter((l) => l.symbol === filter);
  const floor = show === ALL ? null : parseFloor(overInput);
  // A purchase within a cent of even is neither a gain nor a loss.
  const shown = ofAsset.filter((l) =>
    show === "losses"
      ? l.unrealizedGain <= -(floor ?? 0.005)
      : show === "gains"
        ? l.unrealizedGain >= (floor ?? 0.005)
        : true,
  );
  const word = show === "losses" ? "loss" : "gain";
  // Nothing passes the filter: name the closest thing there is, so the empty table still answers.
  const nearest =
    show === ALL
      ? undefined
      : [...ofAsset].sort((a, b) =>
          show === "losses" ? a.unrealizedGain - b.unrealizedGain : b.unrealizedGain - a.unrealizedGain,
        )[0];

  const sorted = [...shown].sort((a, b) => {
    const av = sort.key === "openedAt" ? Date.parse(a.openedAt) : a[sort.key];
    const bv = sort.key === "openedAt" ? Date.parse(b.openedAt) : b[sort.key];
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : av - (bv as number);
    return sort.dir === "asc" ? cmp : -cmp;
  });

  const total = shown.reduce(
    (t, l) => ({
      units: t.units + l.quantity,
      cost: t.cost + l.costBasis,
      value: t.value + l.marketValue,
      gain: t.gain + l.unrealizedGain,
    }),
    { units: 0, cost: 0, value: 0, gain: 0 },
  );
  const turningSoon = shown.filter((l) => !l.isLongTerm && l.daysToLongTerm <= 45).length;

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Every batch of shares you bought, listed separately. Each has its own price paid and
        holding time, and that is what decides the tax when you sell it. Shares you already
        sold are on{" "}
        <Link href="/transactions" className="text-primary hover:underline">
          Transactions
        </Link>
        : tap a sale to see the purchases it used and its gain. To check them against your
        broker, download{" "}
        <a
          href={`/api/export/lots${portfolioId ? `?portfolio=${portfolioId}` : ""}`}
          download
          className="text-primary hover:underline"
        >
          every purchase you hold
        </a>{" "}
        or{" "}
        <a
          href={`/api/export/realized${portfolioId ? `?portfolio=${portfolioId}` : ""}`}
          download
          className="text-primary hover:underline"
        >
          every sale
        </a>{" "}
        as a spreadsheet (CSV).
      </p>
      {symbols.length > 1 && (
        <div className="min-w-0 overflow-x-auto pb-0.5">
          <SegmentedControl
            value={filter}
            onChange={setAssetFilter}
            options={[{ value: ALL, label: "All" }, ...symbols.map((s) => ({ value: s, label: s }))]}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SegmentedControl value={show} onChange={pickShow} options={SHOW_OPTIONS} />
        {show !== ALL && (
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="lots-over" className="text-muted-foreground">
              {show === "losses" ? "Losses" : "Gains"} bigger than
            </label>
            <span className="text-muted-foreground">$</span>
            <Input
              id="lots-over"
              value={overInput}
              onChange={(e) => {
                const v = e.target.value;
                setShowState((s) => ({ ...s, overInput: v }));
              }}
              placeholder="any"
              inputMode="decimal"
              className="data h-8 w-24"
            />
          </div>
        )}
      </div>
      {shown.length === 0 && (
        <p className="border-y py-10 text-center text-sm text-muted-foreground">
          No purchase{filter !== ALL && <> of {filter}</>} is at a {word}
          {floor !== null && <> bigger than {fmtUsd(floor)}</>} right now.
          {nearest &&
            (show === "losses" ? nearest.unrealizedGain < 0 : nearest.unrealizedGain > 0) && (
              <>
                {" "}
                The biggest {word} is {nearest.symbol} bought {nearest.openedAt.slice(0, 10)}:{" "}
                <span className={cn("data", gainClass(nearest.unrealizedGain))}>
                  {fmtUsd(nearest.unrealizedGain)}
                </span>
                .
              </>
            )}
        </p>
      )}
      {shown.length > 0 && (
        <p className="text-sm">
          {shown.length.toLocaleString()} {shown.length === 1 ? "purchase" : "purchases"}
          {filter !== ALL && <> of {fmtUnits(total.units)} {filter}</>}
          {show !== ALL && (
            <>
              {" "}
              at a {word}
              {floor !== null && <> bigger than {fmtUsd(floor)}</>}
            </>
          )}
          : you paid <span className="data">{fmtUsd(total.cost)}</span>, worth{" "}
          <span className="data">{fmtUsd(total.value)}</span> now,{" "}
          <span className={cn("data", gainClass(total.gain))}>
            {fmtUsd(total.gain)} ({fmtPct(gainPct(total.gain, total.cost))})
          </span>{" "}
          if sold.
          {turningSoon > 0 && (
            <span className="text-muted-foreground">
              {" "}
              {turningSoon} {turningSoon === 1 ? "turns" : "turn"} long-term within 45 days.
            </span>
          )}
        </p>
      )}
      <div className={cn("min-w-0 border-t", shown.length === 0 && "hidden")}>
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
              <TableHead className="hidden xl:table-cell">Account</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Units</TableHead>
              <SortableHead label="Bought" sortKey="openedAt" sort={sort} onSort={toggleSort} />
              <TableHead className="hidden text-right lg:table-cell">Paid per unit</TableHead>
              <SortableHead
                label="Cost"
                sortKey="costBasis"
                sort={sort}
                onSort={toggleSort}
                className="hidden sm:table-cell"
              />
              <SortableHead label="Value" sortKey="marketValue" sort={sort} onSort={toggleSort} />
              <SortableHead
                label="Gain if sold"
                sortKey="unrealizedGain"
                sort={sort}
                onSort={toggleSort}
              />
              <TableHead className="hidden pr-1 text-right md:table-cell">Long-term</TableHead>
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
                <TableCell className="hidden text-muted-foreground xl:table-cell">
                  {l.accountName}
                </TableCell>
                <TableCell className="hidden text-right data text-[13px] sm:table-cell">
                  {fmtUnits(l.quantity)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right data text-[13px] text-muted-foreground">
                  {l.openedAt.slice(0, 10)}
                </TableCell>
                <TableCell className="hidden text-right data text-[13px] lg:table-cell">
                  {l.quantity > 0 ? fmtUnitPrice(l.costBasis / l.quantity) : "—"}
                </TableCell>
                <TableCell className="hidden text-right data text-[13px] sm:table-cell">
                  {fmtUsd(l.costBasis)}
                </TableCell>
                <TableCell className="text-right data text-[13px]">
                  {fmtUsd(l.marketValue)}
                </TableCell>
                <TableCell className={cn("text-right data text-[13px]", gainClass(l.unrealizedGain))}>
                  {fmtUsd(l.unrealizedGain)}
                  <div className="text-[11px] opacity-80">
                    {fmtPct(gainPct(l.unrealizedGain, l.costBasis))}
                  </div>
                </TableCell>
                <TableCell className="hidden whitespace-nowrap pr-1 text-right md:table-cell">
                  {l.isLongTerm ? (
                    <span className="text-xs text-muted-foreground">since {l.longTermOn}</span>
                  ) : (
                    <span className="text-xs">
                      <span className="data">{l.longTermOn}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · in {l.daysToLongTerm} {l.daysToLongTerm === 1 ? "day" : "days"}
                      </span>
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="bg-transparent">
            <TableRow className="hover:bg-transparent">
              <TableCell className="pl-1 font-medium">Total</TableCell>
              <TableCell className="hidden xl:table-cell" />
              <TableCell className="hidden text-right data text-[13px] sm:table-cell">
                {filter !== ALL ? fmtUnits(total.units) : ""}
              </TableCell>
              <TableCell />
              <TableCell className="hidden text-right data text-[13px] lg:table-cell">
                {filter !== ALL && total.units > 0 ? fmtUnitPrice(total.cost / total.units) : ""}
              </TableCell>
              <TableCell className="hidden text-right data text-[13px] sm:table-cell">
                {fmtUsd(total.cost)}
              </TableCell>
              <TableCell className="text-right data text-[13px]">{fmtUsd(total.value)}</TableCell>
              <TableCell className={cn("text-right data text-[13px]", gainClass(total.gain))}>
                {fmtUsd(total.gain)}
                <div className="text-[11px] opacity-80">
                  {fmtPct(gainPct(total.gain, total.cost))}
                </div>
              </TableCell>
              <TableCell className="hidden pr-1 md:table-cell" />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
