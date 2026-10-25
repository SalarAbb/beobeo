"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AssetLogo } from "@/components/asset-logo";
import { usePortfolio } from "@/components/portfolio-context";
import { AddTransactionDialog } from "@/components/transactions/add-transaction-dialog";
import { CsvImportDialog } from "@/components/transactions/csv-import-dialog";
import { PageHeader } from "@/components/page-section";
import { Button } from "@/components/ui/button";
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

/** Quiet type pills: the indigo accent marks buys, sells stay neutral (a sell
 *  isn't bad news), and income gets the soft good tint. */
const TYPE_PILL: Record<string, string> = {
  buy: "bg-accent text-primary",
  sell: "bg-secondary text-foreground",
  dividend: "bg-good-soft text-gain",
  split: "border text-muted-foreground",
  transfer_in: "bg-secondary text-muted-foreground",
  transfer_out: "bg-secondary text-muted-foreground",
  fee: "border text-muted-foreground",
};

const fmtMoney = (v: string | null) =>
  v === null
    ? "—"
    : Number(v).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      });

const fmtQty = (v: string) => {
  const n = Number(v);
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
};

export default function TransactionsPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { portfolioId } = usePortfolio();
  const list = useQuery(
    trpc.transactions.list.queryOptions({
      limit: 200,
      portfolioId: portfolioId ?? undefined,
    }),
  );
  const remove = useMutation(trpc.transactions.remove.mutationOptions());
  // Rows hidden while their delete waits out the undo window.
  const [pendingDelete, setPendingDelete] = useState<ReadonlySet<string>>(new Set());

  const unhide = (id: string) =>
    setPendingDelete((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });

  /** Deletes are undoable: the row disappears at once, but the mutation only
   *  runs when the toast closes without "Undo" being pressed. */
  function onDelete(id: string, label: string) {
    setPendingDelete((s) => new Set(s).add(id));
    let settled = false;
    const commit = async () => {
      if (settled) return;
      settled = true;
      try {
        await remove.mutateAsync({ id });
        await queryClient.invalidateQueries({ queryKey: trpc.transactions.list.queryKey() });
      } catch {
        toast.error(`Couldn't delete ${label}`);
      } finally {
        unhide(id);
      }
    };
    toast(`Deleted ${label}`, {
      duration: 6000,
      action: {
        label: "Undo",
        onClick: () => {
          settled = true;
          unhide(id);
        },
      },
      onAutoClose: () => void commit(),
      onDismiss: () => void commit(),
    });
  }

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.transactions.list.queryKey() });

  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-8">
      <PageHeader
        title="Transactions"
        subtitle="The source of truth — everything else is derived from these."
        actions={
          <>
            <CsvImportDialog onImported={refresh} />
            <AddTransactionDialog onCreated={refresh} />
          </>
        }
      />

      <div className="min-w-0 border-t">
        {list.isLoading ? (
          <div className="space-y-2 py-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (list.data?.length ?? 0) === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No transactions yet. Add one manually or import a broker CSV.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-1">Date</TableHead>
                <TableHead>Asset</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Fees</TableHead>
                <TableHead className="hidden md:table-cell">Account</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data!.filter(({ txn }) => !pendingDelete.has(txn.id)).map(({ txn, asset, account }) => (
                <TableRow key={txn.id}>
                  <TableCell className="whitespace-nowrap pl-1 font-mono text-[13px] tabular-nums">
                    {txn.tradedAt.toISOString().slice(0, 10)}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <AssetLogo symbol={asset.symbol} assetClass={asset.class} size={22} />
                      <span className="font-medium">{asset.symbol}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TYPE_PILL[txn.type] ?? TYPE_PILL.fee}`}
                    >
                      {txn.type.replace("_", " ")}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-[13px] tabular-nums">
                    {txn.type === "split" ? `${fmtQty(txn.quantity)}:1` : fmtQty(txn.quantity)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[13px] tabular-nums">
                    {fmtMoney(txn.pricePerUnit)}
                  </TableCell>
                  <TableCell className="hidden text-right font-mono text-[13px] tabular-nums sm:table-cell">
                    {Number(txn.fees) > 0 ? fmtMoney(txn.fees) : "—"}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {account.name}
                  </TableCell>
                  <TableCell className="pr-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${asset.symbol} ${txn.type.replace("_", " ")} on ${txn.tradedAt.toISOString().slice(0, 10)}`}
                      title="Delete (you can undo)"
                      onClick={() => onDelete(txn.id, `${asset.symbol} ${txn.type}`)}
                    >
                      <Trash2 aria-hidden className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
