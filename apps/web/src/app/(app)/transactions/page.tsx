"use client";

import { use, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

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

/** The list's kind filter: olenna couldn't spot a wrong buy among 46 buys and
 *  payouts mixed together (mission 136). */
const TYPE_FILTERS = {
  buy: { label: "Buys", noun: "buys", types: ["buy"] },
  sell: { label: "Sales", noun: "sales", types: ["sell"] },
  dividend: { label: "Dividends", noun: "dividends", types: ["dividend"] },
  other: {
    label: "Splits, transfers, fees",
    noun: "splits, transfers and fees",
    types: ["split", "transfer_in", "transfer_out", "fee"],
  },
} as const satisfies Record<string, { label: string; noun: string; types: readonly TransactionType[] }>;
type TransactionType = TransactionRow["txn"]["type"];
type TypeFilter = keyof typeof TYPE_FILTERS;

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

// Stable, so React calls it once, when the just-added row first mounts.
const scrollToRow = (el: HTMLTableRowElement | null) =>
  el?.scrollIntoView({ block: "center", behavior: "smooth" });

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
  // One asset's history, server-side so it reaches past the newest 200 rows:
  // fred hunted a duplicate SOL buy by eye through every coin's trades (mission 58).
  const [assetPick, setAssetPick] = useState<string | null>(null);
  const assets = useQuery(
    trpc.transactions.assets.queryOptions({ portfolioId: portfolioId ?? undefined }),
  );
  // A pick the current portfolio doesn't hold reads as "All assets".
  const assetFilter = assets.data?.find((a) => a.id === assetPick) ?? null;
  // One account's trades: petyr scrolled the whole list to find BND in his IRA
  // (mission 97). Same input as the nav's warm-up, so it shares that entry.
  const [accountPick, setAccountPick] = useState<string | null>(null);
  const accounts = useQuery(
    trpc.accounts.list.queryOptions({ portfolioId: portfolioId ?? undefined }),
  );
  const accountFilter = accounts.data?.find((a) => a.id === accountPick) ?? null;
  const [typePick, setTypePick] = useState<TypeFilter | null>(null);
  const typeFilter = typePick ? TYPE_FILTERS[typePick] : null;
  const list = useQuery({
    ...trpc.transactions.list.queryOptions({
      limit: 200,
      portfolioId: portfolioId ?? undefined,
      assetId: assetFilter?.id,
      accountId: accountFilter?.id,
      types: typeFilter ? [...typeFilter.types] : undefined,
    }),
    // Switching the asset keeps the old rows (dimmed) instead of flashing a
    // loading line, but never across portfolios.
    placeholderData: (prev, prevQuery) => {
      const input = (prevQuery?.queryKey[1] as { input?: { portfolioId?: string } } | undefined)
        ?.input;
      return input?.portfolioId === (portfolioId ?? undefined) ? keepPreviousData(prev) : undefined;
    },
  });
  // While a pick's rows load, the old list is narrowed to it at once: every
  // coin's rows under "23 O transactions" read as a filter that didn't apply
  // (olenna, mission 99).
  const filtered = assetFilter !== null || accountFilter !== null || typeFilter !== null;
  const narrowing = list.isPlaceholderData && filtered;
  const rows = narrowing
    ? list.data?.filter(
        (r) =>
          (!assetFilter || r.asset.id === assetFilter.id) &&
          (!accountFilter || r.account.id === accountFilter.id) &&
          (!typeFilter || (typeFilter.types as readonly string[]).includes(r.txn.type)),
      )
    : list.data;
  // How many rows the pick will show, when the asset counts say (not per account or kind).
  const expected =
    assetFilter && !accountFilter && !typeFilter ? Math.min(assetFilter.count, 200) : null;
  // "your O buys in Roth IRA", for the labels.
  const what = `your ${assetFilter ? `${assetFilter.symbol} ` : ""}${typeFilter?.noun ?? "transactions"}${accountFilter ? ` in ${accountFilter.name}` : ""}`;
  const remove = useMutation(trpc.transactions.remove.mutationOptions());
  const restore = useMutation(trpc.transactions.restore.mutationOptions());
  const update = useMutation(trpc.transactions.update.mutationOptions());
  // Rows hidden while their delete is on its way to the server.
  const [pendingDelete, setPendingDelete] = useState<ReadonlySet<string>>(new Set());
  // Rows open their details; editing and deleting happen there.
  const [opened, setOpened] = useState<TransactionRow | null>(null);
  // The row just typed in (or put back by Undo) is marked and scrolled to: a
  // backdated payout lands below newer rows, and olenna went back and forth to
  // find hers (missions 112, 113, 136).
  const [marked, setMarked] = useState<{ id: string; tag: "just added" | "back" } | null>(null);

  const unhide = (id: string) =>
    setPendingDelete((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });

  // Everything derived from transactions: the list, holdings, charts, tax. The
  // returned promise is the list's alone: waiting on every recomputed
  // holding kept an undone delete's row hidden and the "46 O transactions"
  // count a step behind (olenna, mission 136).
  const refreshAll = () => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.portfolio.pathKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.tax.pathKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.compare.pathKey() }),
    ]);
    return queryClient.invalidateQueries({ queryKey: trpc.transactions.pathKey() });
  };

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
    // An Undo tapped before the delete's refresh finished: the row is still in
    // the list's data, only hidden.
    unhide(txn.id);
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
    } catch {
      toast.error(`Couldn't put back ${label}`, { id: toastId, description });
      return;
    }
    // "is back" once the list shows it, not while it still reads as deleted.
    await refreshAll().catch(() => {});
    setMarked({ id: txn.id, tag: "back" });
    toast.success(`${label} is back`, { id: toastId, description });
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

  function onCreated(txn: { id: string; assetId: string; accountId: string; type: string }) {
    setMarked({ id: txn.id, tag: "just added" });
    // A filter that would hide it steps aside.
    if (assetFilter && assetFilter.id !== txn.assetId) setAssetPick(null);
    if (accountFilter && accountFilter.id !== txn.accountId) setAccountPick(null);
    if (typeFilter && !(typeFilter.types as readonly string[]).includes(txn.type)) setTypePick(null);
    void refresh();
  }

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.transactions.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.transactions.assets.queryKey() }),
    ]);

  // A sell and a buy of the same size, same asset, same day: a swap, tagged so
  // the pair doesn't read as a double entry.
  const swapIds = new Set<string>();
  const byDay = new Map<string, TransactionRow["txn"][]>();
  for (const { txn } of rows ?? []) {
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
              onCreated={onCreated}
              defaultOpen={params.add === "1" || params.add === "dividend"}
              defaultType={params.add === "dividend" ? "dividend" : "buy"}
            />
          </>
        }
      />

      {((list.data?.length ?? 0) > 1 || filtered) && (
        <div className="-mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span id="txn-show" className="eyebrow">
            Show
          </span>
          {(assets.data?.length ?? 0) > 1 && (
            <Select
              value={assetFilter?.id ?? "all"}
              onValueChange={(v) => setAssetPick(v === "all" ? null : v)}
            >
              <SelectTrigger
                aria-labelledby="txn-show"
                aria-label="Asset"
                className={cn("w-40", assetFilter && "bg-accent text-primary")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All assets</SelectItem>
                {assets.data!.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.symbol}
                    <span className="data text-muted-foreground"> · {a.count}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {(accounts.data?.length ?? 0) > 1 && (
            <Select
              value={accountFilter?.id ?? "all"}
              onValueChange={(v) => setAccountPick(v === "all" ? null : v)}
            >
              <SelectTrigger
                aria-label="Account"
                className={cn("w-48", accountFilter && "bg-accent text-primary")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All accounts</SelectItem>
                {accounts.data!.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select
            value={typePick ?? "all"}
            onValueChange={(v) => setTypePick(v === "all" ? null : (v as TypeFilter))}
          >
            <SelectTrigger
              aria-label="Kind"
              className={cn("w-40", typeFilter && "bg-accent text-primary")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              {(Object.keys(TYPE_FILTERS) as TypeFilter[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {TYPE_FILTERS[k].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filtered && (
            <span className="text-sm text-muted-foreground">
              {expected === null
                ? `${(rows?.length ?? 0) >= 200 ? "The newest 200 of" : "All"} ${what}, newest first.`
                : assetFilter!.count > 200
                  ? `The newest 200 of ${assetFilter!.count} ${assetFilter!.symbol} transactions.`
                  : `${assetFilter!.count} ${assetFilter!.symbol} transaction${assetFilter!.count === 1 ? "" : "s"}, newest first.`}{" "}
              <button
                type="button"
                className="text-primary underline-offset-4 hover:underline"
                onClick={() => {
                  setAssetPick(null);
                  setAccountPick(null);
                  setTypePick(null);
                }}
              >
                Show all
              </button>
            </span>
          )}
        </div>
      )}

      <div className={cn("min-w-0 border-t transition-opacity", list.isPlaceholderData && "opacity-60")}>
        {list.isLoading || (narrowing && rows?.length === 0) ? (
          <TabLoading label={`Loading ${what}…`} className="my-4 h-24" />
        ) : list.isError && !list.data ? (
          <TabError what={what} onRetry={() => void list.refetch()} />
        ) : (rows?.length ?? 0) === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {filtered
              ? `No ${what.replace(/^your /, "")} yet.`
              : "No transactions yet. Add one manually or import a broker CSV."}
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
              {rows!.filter(({ txn }) => !pendingDelete.has(txn.id)).map(({ txn, asset, account }) => (
                <TableRow
                  key={txn.id}
                  ref={txn.id === marked?.id ? scrollToRow : undefined}
                  className={cn("cursor-pointer", txn.id === marked?.id && "bg-accent/60")}
                  onClick={() => setOpened({ txn, asset, account })}
                  // A sale's details replay the asset's sales; start it on the way to the click.
                  onPointerEnter={
                    txn.type === "sell"
                      ? () =>
                          void queryClient.prefetchQuery(
                            trpc.portfolio.sales.queryOptions({
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
                    {txn.id === marked?.id && (
                      <span className="ml-1.5 rounded-full border border-primary/40 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-primary">
                        {marked.tag}
                      </span>
                    )}
                    {swapIds.has(txn.id) && (
                      <span
                        className="ml-1.5 rounded-full border px-1.5 py-0.5 text-[11px] whitespace-nowrap text-muted-foreground"
                        title="Sold and bought back the same day, so not a duplicate"
                      >
                        swap
                        <span className="hidden sm:inline">
                          {txn.type === "sell" ? ": sold" : ": bought back"}
                        </span>
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
        {narrowing && (rows?.length ?? 0) > 0 && (expected === null || rows!.length < expected) && (
          <TabLoading label={`Loading the rest of ${what}…`} className="my-3 h-10" />
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
