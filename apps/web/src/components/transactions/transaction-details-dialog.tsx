"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { DatePicker } from "@/components/date-picker";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

/** The fields an edit can change. Type and asset stay: a buy that should have
 *  been a sell is a different trade, so it's deleted and entered again. */
export type TransactionEdit = {
  accountId: string;
  quantity: string;
  pricePerUnit: string | null;
  fees: string;
  tradedAt: Date;
};

/** "Quantity 19.565 → 1.9565 · Price $71.52 → $71.50", for the saved toast. */
export function describeEdit({ txn, account }: TransactionRow, edit: TransactionEdit) {
  const changes: string[] = [];
  const num = (a: string | null, b: string | null) => (a === null ? null : Number(a)) !== (b === null ? null : Number(b));
  if (isoDay(edit.tradedAt) !== isoDay(txn.tradedAt))
    changes.push(`Date ${isoDay(txn.tradedAt)} → ${isoDay(edit.tradedAt)}`);
  if (num(edit.quantity, txn.quantity))
    changes.push(`Quantity ${fmtQty(Number(txn.quantity))} → ${fmtQty(Number(edit.quantity))}`);
  if (num(edit.pricePerUnit, txn.pricePerUnit) && edit.pricePerUnit !== null)
    changes.push(`Price ${txn.pricePerUnit === null ? "—" : fmtUsd(Number(txn.pricePerUnit))} → ${fmtUsd(Number(edit.pricePerUnit))}`);
  if (num(edit.fees, txn.fees)) changes.push(`Fees ${fmtUsd(Number(txn.fees))} → ${fmtUsd(Number(edit.fees))}`);
  if (edit.accountId !== txn.accountId) changes.push(`Moved from ${account.name}`);
  return changes.join(" · ") || "Nothing changed";
}

/** One transaction, opened from its row: the full record, and for a sale the
 *  purchases it used and the gain. Editing and deleting live here (deleting
 *  behind a confirm step), so a tap on a row can never change anything. */
/** What the other trades in the same asset that day say about this one: a
 *  sell and a buy of the same size is a swap (sell and buy back, e.g. to take
 *  a loss), not a double entry. fred deleted the buy half of his own swap
 *  thinking it was a duplicate (missions 36 and 43). */
export function sameDayNote({ txn, asset }: TransactionRow, sameDay: TransactionRow[]) {
  const qty = Number(txn.quantity);
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-8, Math.abs(b) * 1e-6);
  const opposite = txn.type === "buy" ? "sell" : txn.type === "sell" ? "buy" : null;
  const swap = sameDay.find((o) => o.txn.type === opposite && near(Number(o.txn.quantity), qty));
  if (swap)
    return {
      tone: "info" as const,
      text:
        txn.type === "buy"
          ? `Not a duplicate: you sold the same ${fmtQty(qty)} ${asset.symbol} that day and bought it back here (a swap, e.g. to take a loss). Deleting this buy leaves the sale without the shares you bought back.`
          : `Not a duplicate: you bought the same ${fmtQty(qty)} ${asset.symbol} back that day (a swap, e.g. to take a loss).`,
    };
  const twin = sameDay.find(
    (o) =>
      o.txn.type === txn.type &&
      near(Number(o.txn.quantity), qty) &&
      Number(o.txn.pricePerUnit) === Number(txn.pricePerUnit) &&
      o.txn.accountId === txn.accountId,
  );
  if (twin)
    return {
      tone: "warn" as const,
      text: `Possible duplicate: another ${typeLabel(txn.type)} of the same ${fmtQty(qty)} ${asset.symbol} at the same price, same day, same account.`,
    };
  if (sameDay.length > 0)
    return {
      tone: "info" as const,
      text: `Also that day in ${asset.symbol}: ${sameDay
        .map((o) => `${typeLabel(o.txn.type)} of ${fmtQty(Number(o.txn.quantity))}`)
        .join(", ")}.`,
    };
  return null;
}

export function TransactionDetailsDialog({
  row,
  sameDay,
  portfolioId,
  onOpenChange,
  onDelete,
  onEdit,
}: {
  row: TransactionRow | null;
  sameDay: TransactionRow[];
  portfolioId: string | undefined;
  onOpenChange: (open: boolean) => void;
  onDelete: (row: TransactionRow) => void;
  onEdit: (row: TransactionRow, edit: TransactionEdit) => void;
}) {
  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        // A half-typed edit is precious, same as the add form.
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Keyed so the confirm and edit steps reset for every transaction opened. */}
        {row && (
          <Details
            key={row.txn.id}
            row={row}
            note={sameDayNote(row, sameDay)}
            portfolioId={portfolioId}
            onDelete={onDelete}
            onEdit={onEdit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Details({
  row,
  note,
  portfolioId,
  onDelete,
  onEdit,
}: {
  row: TransactionRow;
  note: ReturnType<typeof sameDayNote>;
  portfolioId: string | undefined;
  onDelete: (row: TransactionRow) => void;
  onEdit: (row: TransactionRow, edit: TransactionEdit) => void;
}) {
  const { txn, asset, account } = row;
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <EditForm
        row={row}
        portfolioId={portfolioId}
        onCancel={() => setEditing(false)}
        onSave={(edit) => onEdit(row, edit)}
      />
    );
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

      {note && (
        <p className={`rounded-md p-3 text-sm ${note.tone === "warn" ? "bg-warn-soft" : "bg-accent"}`}>
          {note.text}
        </p>
      )}

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
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setConfirming(true)}
            >
              Delete…
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
        </DialogFooter>
      )}
    </>
  );
}

const decimal = /^\d+(\.\d+)?$/;
// "71.5200000000" → "71.52": numeric columns come back padded to their scale.
const trimZeros = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

/** Fix a trade in place: date, quantity, price, fees and account. A dividend
 *  edits its cash (stored as 1 × amount); a split edits its ratio. */
function EditForm({
  row,
  portfolioId,
  onCancel,
  onSave,
}: {
  row: TransactionRow;
  portfolioId: string | undefined;
  onCancel: () => void;
  onSave: (edit: TransactionEdit) => void;
}) {
  const { txn, asset, account } = row;
  const trpc = useTRPC();
  const accounts = useQuery(trpc.accounts.list.queryOptions({ portfolioId }));
  const kind = txn.type === "dividend" ? "dividend" : txn.type === "split" ? "split" : txn.pricePerUnit === null ? "noPrice" : "priced";
  const originalAmount = transactionAmount(txn);
  const [date, setDate] = useState(isoDay(txn.tradedAt));
  const [quantity, setQuantity] = useState(trimZeros(txn.quantity));
  const [price, setPrice] = useState(txn.pricePerUnit === null ? "" : trimZeros(txn.pricePerUnit));
  const [cash, setCash] = useState(
    kind === "dividend" && originalAmount ? String(Math.round(originalAmount.value * 100) / 100) : "",
  );
  const [fees, setFees] = useState(trimZeros(txn.fees));
  const [accountId, setAccountId] = useState(txn.accountId);

  const options = accounts.data?.some((a) => a.id === account.id)
    ? accounts.data
    : [account, ...(accounts.data ?? [])];
  const feesValue = fees.trim() === "" ? "0" : fees.trim();
  const error =
    kind === "dividend"
      ? !decimal.test(cash) || Number(cash) <= 0
        ? "Enter the cash you received"
        : null
      : !decimal.test(quantity) || Number(quantity) <= 0
        ? kind === "split" ? "Enter the split ratio, e.g. 4 for 4-for-1" : "Enter a quantity above 0"
        : kind === "priced" && !decimal.test(price)
          ? "Enter the price per unit"
          : !decimal.test(feesValue)
            ? "Fees must be a number"
            : null;
  const amount =
    kind === "priced" && !error
      ? transactionAmount({ ...txn, quantity, pricePerUnit: price, fees: feesValue })
      : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (error) return;
    onSave({
      accountId,
      quantity: kind === "dividend" ? "1" : quantity,
      pricePerUnit: kind === "dividend" ? cash : kind === "priced" ? price : txn.pricePerUnit,
      fees: kind === "dividend" || kind === "split" ? txn.fees : feesValue,
      // Keep the stored time when the day is unchanged; a new day is noon UTC like the add form.
      tradedAt: date === isoDay(txn.tradedAt) ? txn.tradedAt : new Date(`${date}T12:00:00Z`),
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader className="text-left">
        <DialogTitle className="flex items-center gap-2">
          <AssetLogo symbol={asset.symbol} assetClass={asset.class} size={24} />
          Edit <span className="capitalize">{typeLabel(txn.type)}</span> {asset.symbol}
        </DialogTitle>
        <DialogDescription>
          Holdings, gains and charts are recalculated with the new values. To change the asset or the
          kind of trade, delete it and add it again.
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 grid gap-1.5">
          <Label>Date</Label>
          <DatePicker value={date} onChange={setDate} />
        </div>
        {kind === "dividend" ? (
          <div className="col-span-2 grid gap-1.5">
            <Label htmlFor="edit-cash">Cash received</Label>
            <Input id="edit-cash" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value.trim())} />
          </div>
        ) : (
          <>
            <div className={`grid gap-1.5 ${kind === "priced" ? "" : "col-span-2"}`}>
              <Label htmlFor="edit-qty">{kind === "split" ? "Ratio" : "Quantity"}</Label>
              <Input id="edit-qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value.trim())} />
            </div>
            {kind === "priced" && (
              <div className="grid gap-1.5">
                <Label htmlFor="edit-price">Price per unit</Label>
                <Input id="edit-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.trim())} />
              </div>
            )}
            {kind !== "split" && (
              <div className="grid gap-1.5">
                <Label htmlFor="edit-fees">Fees</Label>
                <Input id="edit-fees" inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value.trim())} placeholder="0" />
              </div>
            )}
          </>
        )}
        <div className={`grid min-w-0 gap-1.5 ${kind === "priced" || kind === "noPrice" ? "" : "col-span-2"}`}>
          <Label>Account</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger className="w-full min-w-0 overflow-hidden">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex h-9 items-center justify-between rounded-md bg-muted/50 px-3 text-sm">
        {error ? (
          <span className="text-muted-foreground">{error}</span>
        ) : amount ? (
          <>
            <span className="text-muted-foreground">{amount.label}</span>
            <span className="data font-semibold">
              {originalAmount && Math.abs(originalAmount.value - amount.value) >= 0.005 && (
                <span className="mr-2 font-normal text-muted-foreground line-through">
                  {fmtUsd(originalAmount.value)}
                </span>
              )}
              {fmtUsd(amount.value)}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">{fmtQty(Number(txn.quantity))} {asset.symbol} before this edit</span>
        )}
      </div>

      <DialogFooter className="flex-row justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={error !== null}>
          Save changes
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The purchases a sale used (first in, first out) and what it realized, from
 *  the same replay as the position page (`portfolio.sales`: that replay
 *  without the position's prices, so it doesn't wait on a quote). */
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
  const sales = useQuery(trpc.portfolio.sales.queryOptions({ assetId, portfolioId }));
  // Words, not a bare gray box: a cold replay takes a moment and an empty
  // skeleton read as "no details here" (barristan, mission 13).
  if (sales.isLoading)
    return (
      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground">Working out which purchases this sale used…</p>
        <Skeleton className="h-12 w-full" />
      </div>
    );
  const lots = sales.data?.filter((g) => g.sourceTxnId === txnId) ?? [];
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
