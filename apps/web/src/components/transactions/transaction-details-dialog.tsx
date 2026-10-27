"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers";
import { AssetLogo } from "@/components/asset-logo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";
import { fmtQty, fmtUsd, gainClass } from "@/lib/viz";

export type TransactionRow = inferRouterOutputs<AppRouter>["transactions"]["list"][number];

const typeLabel = (t: string) => t.replace("_", " ");
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** What the trade moved in dollars, display math only: a buy costs qty × price
 *  plus fees, a sell brings in qty × price minus fees, a dividend is the cash. */
export function transactionAmount({ type, quantity, pricePerUnit, fees }: TransactionRow["txn"]) {
  if (pricePerUnit === null) return null;
  const gross = Number(quantity) * Number(pricePerUnit);
  if (type === "buy") return { label: "Total cost", value: gross + Number(fees) };
  if (type === "sell") return { label: "Net proceeds", value: gross - Number(fees) };
  if (type === "dividend") return { label: "Cash received", value: gross };
  if (type === "transfer_in" || type === "transfer_out") return { label: "Value", value: gross };
  return null;
}

/** One transaction, opened from its row: the full record, and for a sale the
 *  purchases it used and the gain. Deleting lives here, behind a confirm step,
 *  so a tap on a row can never remove anything. */
export function TransactionDetailsDialog({
  row,
  portfolioId,
  onOpenChange,
  onDelete,
}: {
  row: TransactionRow | null;
  portfolioId: string | undefined;
  onOpenChange: (open: boolean) => void;
  onDelete: (row: TransactionRow) => void;
}) {
  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Keyed so the confirm step resets for every transaction opened. */}
        {row && <Details key={row.txn.id} row={row} portfolioId={portfolioId} onDelete={onDelete} />}
      </DialogContent>
    </Dialog>
  );
}

function Details({
  row,
  portfolioId,
  onDelete,
}: {
  row: TransactionRow;
  portfolioId: string | undefined;
  onDelete: (row: TransactionRow) => void;
}) {
  const { txn, asset, account } = row;
  const [confirming, setConfirming] = useState(false);
  const amount = transactionAmount(txn);
  const day = isoDay(txn.tradedAt);
  const summary = `${typeLabel(txn.type)} of ${fmtQty(Number(txn.quantity))} ${asset.symbol} on ${day}`;

  const facts: [string, string][] = [
    ["Date", day],
    ["Quantity", txn.type === "split" ? `${fmtQty(Number(txn.quantity))}:1` : fmtQty(Number(txn.quantity))],
    ["Price", txn.pricePerUnit === null ? "—" : fmtUsd(Number(txn.pricePerUnit))],
    ["Fees", Number(txn.fees) > 0 ? fmtUsd(Number(txn.fees)) : "—"],
    ...(amount ? [[amount.label, fmtUsd(amount.value)] as [string, string]] : []),
    ["Account", account.name],
  ];

  return (
    <>
      <DialogHeader className="text-left">
        <DialogTitle className="flex items-center gap-2">
          <AssetLogo symbol={asset.symbol} assetClass={asset.class} size={24} />
          <span className="capitalize">{typeLabel(txn.type)}</span> {asset.symbol}
        </DialogTitle>
        <DialogDescription>{asset.name}</DialogDescription>
      </DialogHeader>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border text-sm">
        {facts.map(([k, v]) => (
          <div key={k} className="bg-background px-3 py-2">
            <dt className="eyebrow">{k}</dt>
            <dd className="data mt-0.5">{v}</dd>
          </div>
        ))}
      </dl>

      {txn.type === "sell" && <SaleLots txnId={txn.id} assetId={asset.id} portfolioId={portfolioId} />}

      {confirming ? (
        <div className="grid gap-3 rounded-md bg-bad-soft p-3 text-sm">
          <p>
            Delete this {summary}? Your holdings, gains and charts are recalculated without it. You can
            undo for a few seconds afterwards.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
            <Button variant="destructive" size="sm" onClick={() => onDelete(row)}>
              Delete {typeLabel(txn.type)}
            </Button>
          </div>
        </div>
      ) : (
        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          <Button variant="link" className="px-0" asChild>
            <Link href={`/positions/${asset.id}`}>Open {asset.symbol}</Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setConfirming(true)}
          >
            Delete…
          </Button>
        </DialogFooter>
      )}
    </>
  );
}

/** The purchases a sale used (first in, first out) and what it realized, from
 *  the same replay as the position page. */
function SaleLots({
  txnId,
  assetId,
  portfolioId,
}: {
  txnId: string;
  assetId: string;
  portfolioId: string | undefined;
}) {
  const trpc = useTRPC();
  const position = useQuery(trpc.portfolio.position.queryOptions({ assetId, portfolioId }));
  // Words, not a bare gray box: a cold replay takes a few seconds and an empty
  // skeleton read as "no details here" (barristan, mission 13).
  if (position.isLoading)
    return (
      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground">Working out which purchases this sale used…</p>
        <Skeleton className="h-12 w-full" />
      </div>
    );
  const lots = position.data?.realizedEntries.filter((g) => g.sourceTxnId === txnId) ?? [];
  if (lots.length === 0) return null;

  const total = lots.reduce((s, g) => s + g.gain, 0);
  const shortTerm = lots.filter((g) => !g.longTerm).reduce((s, g) => s + g.gain, 0);
  const longTerm = total - shortTerm;
  const split =
    lots.every((g) => g.longTerm) ? "all long-term" : lots.every((g) => !g.longTerm) ? "all short-term"
    : `${fmtUsd(shortTerm)} short-term · ${fmtUsd(longTerm)} long-term`;

  return (
    <div className="grid gap-2 text-sm">
      <p>
        This sale {total >= 0 ? "realized a gain of" : "realized a loss of"}{" "}
        <span className={`data font-semibold ${gainClass(total)}`}>{fmtUsd(Math.abs(total))}</span>,{" "}
        <span className="text-muted-foreground">{split}.</span>
      </p>
      <div className="eyebrow">
        {lots.length === 1 ? "Purchase it used" : `${lots.length} purchases it used, oldest first`}
      </div>
      <ul className="max-h-48 divide-y overflow-y-auto border-y">
        {lots.map((g, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 py-1.5">
            <span className="data text-[13px]">
              {fmtQty(g.quantity)} bought {g.acquiredAt}
              <span className="text-muted-foreground"> · {g.longTerm ? "long" : "short"}</span>
            </span>
            <span className={`data text-[13px] ${gainClass(g.gain)}`}>{fmtUsd(g.gain)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
