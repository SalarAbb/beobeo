"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AssetLogo } from "@/components/asset-logo";
import { usePortfolio } from "@/components/portfolio-context";
import { AddTransactionDialog } from "@/components/transactions/add-transaction-dialog";
import { CsvImportDialog } from "@/components/transactions/csv-import-dialog";
import { ExportMenu } from "@/components/transactions/export-menu";
import {
  TransactionDetailsDialog,
  describeEdit,
  transactionAmount,
  type TransactionEdit,
  type TransactionRow,
} from "@/components/transactions/transaction-details-dialog";
import { PageHeader } from "@/components/page-section";
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
  const restore = useMutation(trpc.transactions.restore.mutationOptions());
  const update = useMutation(trpc.transactions.update.mutationOptions());
  // Rows hidden while their delete is on its way to the server.
  const [pendingDelete, setPendingDelete] = useState<ReadonlySet<string>>(new Set());
  // Rows open their details; editing and deleting happen there.
  const [opened, setOpened] = useState<TransactionRow | null>(null);

  const unhide = (id: string) =>
    setPendingDelete((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });

  // Everything derived from transactions: the list, holdings, charts, tax.
  const refreshAll = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.transactions.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.portfolio.pathKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.tax.pathKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.compare.pathKey() }),
    ]);

  /** Deletes commit at once and "Undo" puts the row back. A delete that waited
   *  for its toast to close was lost when the page was left before then, and
   *  the dashboard showed the old numbers meanwhile (fred, mission 36). */
  async function onDelete({ txn, asset }: TransactionRow) {
    const id = txn.id;
    const label = `${asset.symbol} ${txn.type.replace("_", " ")}`;
    // Name the exact row: several buys of one asset look alike.
    const description = `${fmtQty(txn.quantity)} on ${txn.tradedAt.toISOString().slice(0, 10)}`;
    setOpened(null);
    setPendingDelete((s) => new Set(s).add(id));
    const toastId = toast.loading(`Deleting ${label}…`, { description });
    try {
      await remove.mutateAsync({ id });
    } catch {
      unhide(id);
      toast.error(`Couldn't delete ${label}`, { id: toastId, description });
      return;
    }
    // The delete already landed, so a long window costs nothing; 10s ran out
    // while fred was still reading the list (mission 43).
    toast.success(`Deleted ${label}`, {
      id: toastId,
      description,
      duration: 30_000,
      action: {
        label: "Undo",
        onClick: () => void undoDelete(txn, label, description),
      },
    });
    await refreshAll();
    unhide(id);
  }

  async function undoDelete(txn: TransactionRow["txn"], label: string, description: string) {
    const toastId = toast.loading(`Putting back ${label}…`, { description });
    try {
      await restore.mutateAsync({
        id: txn.id,
        accountId: txn.accountId,
        assetId: txn.assetId,
        type: txn.type,
        quantity: txn.quantity,
        pricePerUnit: txn.pricePerUnit,
        fees: txn.fees,
        tradedAt: txn.tradedAt,
        note: txn.note ?? undefined,
        source: txn.source,
      });
      toast.success(`${label} is back`, { id: toastId, description });
    } catch {
      toast.error(`Couldn't put back ${label}`, { id: toastId, description });
    }
    await refreshAll();
  }

  /** Saves an edit and offers to undo it (the old values go back). */
  async function onEdit(row: TransactionRow, edit: TransactionEdit) {
    const { txn, asset } = row;
    const label = `${asset.symbol} ${txn.type.replace("_", " ")}`;
    setOpened(null);
    const toastId = toast.loading(`Saving ${label}…`);
    try {
      await update.mutateAsync({ id: txn.id, data: edit });
    } catch (err) {
      toast.error(`Couldn't save the ${label}: ${(err as Error).message}`, {
        id: toastId,
        duration: 10_000,
        action: { label: "Open it again", onClick: () => setOpened(row) },
      });
      return;
    }
    const before: TransactionEdit = {
      accountId: txn.accountId,
      quantity: txn.quantity,
      pricePerUnit: txn.pricePerUnit,
      fees: txn.fees,
      tradedAt: txn.tradedAt,
    };
    toast.success(`${label} updated`, {
      id: toastId,
      description: describeEdit(row, edit),
      duration: 30_000,
      action: {
        label: "Undo",
        onClick: async () => {
          await update.mutateAsync({ id: txn.id, data: before }).then(
            () => toast.success(`${label} is back as it was`),
            () => toast.error(`Couldn't undo the change to ${label}`),
          );
          await refreshAll();
        },
      },
    });
    await refreshAll();
  }

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.transactions.list.queryKey() });

  // A sell and a buy of the same size, same asset, same day: a swap, tagged so
  // the pair doesn't read as a double entry.
  const swapIds = new Set<string>();
  const byDay = new Map<string, TransactionRow["txn"][]>();
  for (const { txn } of list.data ?? []) {
    if (txn.type !== "buy" && txn.type !== "sell") continue;
    const key = `${txn.assetId}:${txn.tradedAt.toISOString().slice(0, 10)}:${Number(txn.quantity)}`;
    const same = byDay.get(key) ?? [];
    for (const o of same) if (o.type !== txn.type) swapIds.add(o.id).add(txn.id);
    byDay.set(key, [...same, txn]);
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-8">
      <PageHeader
        title="Transactions"
        subtitle="The source of truth — everything else is derived from these."
        actions={
          <>
            <ExportMenu portfolioId={portfolioId ?? undefined} />
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
          <TabLoading label="Loading your transactions…" className="my-4 h-24" />
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
                    {swapIds.has(txn.id) && (
                      <span
                        className="ml-1.5 text-xs text-muted-foreground"
                        title="Sold and bought back the same day"
                      >
                        swap
                      </span>
                    )}
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
        sameDay={
          opened
            ? (list.data ?? []).filter(
                ({ txn }) =>
                  txn.id !== opened.txn.id &&
                  txn.assetId === opened.txn.assetId &&
                  txn.tradedAt.toISOString().slice(0, 10) === opened.txn.tradedAt.toISOString().slice(0, 10),
              )
            : []
        }
        portfolioId={portfolioId ?? undefined}
        onOpenChange={(open) => !open && setOpened(null)}
        onDelete={(row) => void onDelete(row)}
        onEdit={(row, edit) => void onEdit(row, edit)}
      />
    </div>
  );
}
