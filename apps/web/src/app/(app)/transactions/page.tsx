"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AssetLogo } from "@/components/asset-logo";
import { usePortfolio } from "@/components/portfolio-context";
import { AddTransactionDialog } from "@/components/transactions/add-transaction-dialog";
import { CsvImportDialog } from "@/components/transactions/csv-import-dialog";
import { Badge } from "@/components/ui/badge";
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

const TYPE_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  buy: "default",
  sell: "destructive",
  dividend: "secondary",
  split: "outline",
  transfer_in: "secondary",
  transfer_out: "secondary",
  fee: "outline",
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

  async function onDelete(id: string, label: string) {
    await remove.mutateAsync({ id });
    await queryClient.invalidateQueries({ queryKey: trpc.transactions.list.queryKey() });
    toast.success(`Deleted ${label}`);
  }

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.transactions.list.queryKey() });

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
          <p className="text-sm text-muted-foreground">
            The source of truth — everything else is derived from these.
          </p>
        </div>
        <div className="flex gap-2">
          <CsvImportDialog onImported={refresh} />
          <AddTransactionDialog onCreated={refresh} />
        </div>
      </div>

      <div className="mt-6 rounded-lg border">
        {list.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (list.data?.length ?? 0) === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No transactions yet. Add one manually or import a broker CSV.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Asset</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Fees</TableHead>
                <TableHead>Account</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data!.map(({ txn, asset, account }) => (
                <TableRow key={txn.id}>
                  <TableCell className="whitespace-nowrap">
                    {txn.tradedAt.toISOString().slice(0, 10)}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <AssetLogo symbol={asset.symbol} assetClass={asset.class} size={22} />
                      <span className="font-medium">{asset.symbol}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={TYPE_BADGE[txn.type] ?? "outline"}>
                      {txn.type.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {txn.type === "split" ? `${fmtQty(txn.quantity)}:1` : fmtQty(txn.quantity)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {fmtMoney(txn.pricePerUnit)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {Number(txn.fees) > 0 ? fmtMoney(txn.fees) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{account.name}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        void onDelete(txn.id, `${asset.symbol} ${txn.type}`)
                      }
                    >
                      <Trash2 className="size-3.5" />
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
