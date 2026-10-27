"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AssetLogo } from "@/components/asset-logo";
import { usePortfolio } from "@/components/portfolio-context";
import { AddTransactionDialog } from "@/components/transactions/add-transaction-dialog";
import { CsvImportDialog } from "@/components/transactions/csv-import-dialog";
import {
  TransactionDetailsDialog,
  transactionAmount,
  type TransactionRow,
} from "@/components/transactions/transaction-details-dialog";
import { PageHeader } from "@/components/page-section";
import { Skeleton } from "@/components/ui/skeleton";
import { TabError } from "@/components/tax-center/tab-state";
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

const fmtAmount = (v: number | undefined) =>
  v === undefined ? "—" : v.toLocaleString("en-US", { style: "currency", currency: "USD" });

const fmtQty = (v: string) => {
  const n = Number(v);
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
};

export default function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string; import?: string }>;
}) {
  // ?add=1 / ?import=1 open a dialog straight away (welcome flow's last step);
  // ?add=dividend opens it on Dividend (the dashboard's Dividends tile).
  const params = use(searchParams);
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
  // Rows open their details; deleting happens there, behind a confirm step.
  const [opened, setOpened] = useState<TransactionRow | null>(null);

  const unhide = (id: string) =>
    setPendingDelete((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });

  /** Deletes are undoable: the row disappears at once, but the mutation only
   *  runs when the toast closes without "Undo" being pressed. */
  function onDelete({ txn, asset }: TransactionRow) {
    const id = txn.id;
    const label = `${asset.symbol} ${txn.type.replace("_", " ")}`;
    setOpened(null);
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
    // Name the exact row (several buys of one asset look alike) and leave
    // time to read it before the delete commits.
    toast(`Deleted ${label}`, {
      description: `${fmtQty(txn.quantity)} on ${txn.tradedAt.toISOString().slice(0, 10)}`,
      duration: 10_000,
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
            <CsvImportDialog onImported={refresh} defaultOpen={params.import === "1"} />
            <AddTransactionDialog
              onCreated={refresh}
              defaultOpen={params.add === "1" || params.add === "dividend"}
              defaultType={params.add === "dividend" ? "dividend" : "buy"}
            />
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
        ) : list.isError && !list.data ? (
          <TabError what="your transactions" onRetry={() => void list.refetch()} />
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
                <TableHead className="hidden text-right sm:table-cell">Amount</TableHead>
                <TableHead className="hidden md:table-cell">Account</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data!.filter(({ txn }) => !pendingDelete.has(txn.id)).map(({ txn, asset, account }) => (
                <TableRow
                  key={txn.id}
                  className="cursor-pointer"
                  onClick={() => setOpened({ txn, asset, account })}
                  // A sale's details replay the position; start it on the way to the click.
                  onPointerEnter={
                    txn.type === "sell"
                      ? () =>
                          void queryClient.prefetchQuery(
                            trpc.portfolio.position.queryOptions({
                              assetId: asset.id,
                              portfolioId: portfolioId ?? undefined,
                            }),
                          )
                      : undefined
                  }
                >
                  <TableCell className="whitespace-nowrap pl-1 data text-[13px]">
                    {txn.tradedAt.toISOString().slice(0, 10)}
                  </TableCell>
                  <TableCell>
                    {/* The row's keyboard/screen-reader entry point; the whole row is the mouse target. */}
                    <button
                      type="button"
                      className="flex items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Open ${asset.symbol} ${txn.type.replace("_", " ")} on ${txn.tradedAt.toISOString().slice(0, 10)}`}
                    >
                      <AssetLogo symbol={asset.symbol} assetClass={asset.class} size={22} />
                      <span className="font-medium">{asset.symbol}</span>
                    </button>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TYPE_PILL[txn.type] ?? TYPE_PILL.fee}`}
                    >
                      {txn.type.replace("_", " ")}
                    </span>
                  </TableCell>
                  <TableCell className="text-right data text-[13px]">
                    {txn.type === "split" ? `${fmtQty(txn.quantity)}:1` : fmtQty(txn.quantity)}
                  </TableCell>
                  <TableCell className="text-right data text-[13px]">
                    {fmtMoney(txn.pricePerUnit)}
                  </TableCell>
                  <TableCell className="hidden text-right data text-[13px] sm:table-cell">
                    {fmtAmount(transactionAmount(txn)?.value)}
                  </TableCell>
                  <TableCell className="hidden pr-1 text-muted-foreground md:table-cell">
                    {account.name}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <TransactionDetailsDialog
        row={opened}
        portfolioId={portfolioId ?? undefined}
        onOpenChange={(open) => !open && setOpened(null)}
        onDelete={onDelete}
      />
    </div>
  );
}
