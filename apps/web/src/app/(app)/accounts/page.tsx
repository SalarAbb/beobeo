"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, Section } from "@/components/page-section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Link from "next/link";
import { TabError, TabLoading } from "@/components/tax-center/tab-state";
import { useTRPC } from "@/lib/trpc";
import { fmtQty, fmtUsd, gainClass } from "@/lib/viz";

const TYPE_LABEL = {
  taxable: "Taxable",
  traditional_ira: "Traditional IRA",
  roth_ira: "Roth IRA",
  "401k": "401(k)",
  other_tax_advantaged: "Other tax-advantaged",
} as const;

const TYPE_OPTIONS = Object.entries(TYPE_LABEL);
type AccountType = keyof typeof TYPE_LABEL;

export default function AccountsPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const accounts = useQuery(trpc.accounts.list.queryOptions({}));
  const portfolios = useQuery(trpc.portfolios.list.queryOptions());
  // Each account's holdings and value (petyr, mission 97: "where are the
  // holdings and balances per account?"; he pieced BND-in-the-IRA together
  // from Transactions and the Tax Center).
  const holdings = useQuery(trpc.accounts.holdings.queryOptions({}));
  const update = useMutation(
    trpc.accounts.update.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.accounts.list.queryOptions({}).queryKey,
        });
      },
    }),
  );

  const portfolioName = new Map((portfolios.data ?? []).map((p) => [p.id, p.name]));
  const heldIn = new Map((holdings.data ?? []).map((h) => [h.accountId, h]));
  const total = (holdings.data ?? []).reduce((s, h) => s + h.value, 0);
  const typeOf = new Map((accounts.data ?? []).map((a) => [a.id, a.accountType as AccountType]));

  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-12">
      <PageHeader
        title="Accounts"
        subtitle={
          "Flag which accounts are taxable brokerages vs. tax-advantaged (IRA, 401k) — " +
          "the Tax Center only sells from taxable accounts, and checks every account " +
          "here for a recent buy that would stop a loss from counting."
        }
      />

      <Section title="Your accounts">
          {accounts.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : accounts.data && accounts.data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-1">Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Institution</TableHead>
                  <TableHead className="hidden sm:table-cell">Portfolio</TableHead>
                  {/* On phones the value moves to each account's heading below (room for Type) */}
                  <TableHead className="hidden text-right sm:table-cell">Value</TableHead>
                  <TableHead className="pr-1 text-right">Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.data.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="pl-1 font-medium">{a.name}</TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {a.institution ?? "—"}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {a.portfolioId ? (portfolioName.get(a.portfolioId) ?? "—") : "—"}
                    </TableCell>
                    <TableCell className="data hidden text-right sm:table-cell">
                      {holdings.data ? fmtUsd(heldIn.get(a.id)?.value ?? 0) : "…"}
                    </TableCell>
                    <TableCell className="pr-1 text-right">
                      <Select
                        value={a.accountType}
                        onValueChange={(accountType) =>
                          update.mutate({ id: a.id, accountType: accountType as AccountType })
                        }
                      >
                        <SelectTrigger size="sm" className="ml-auto w-40 sm:w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="end">
                          {TYPE_OPTIONS.map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No accounts yet — add one from the transaction form.
            </p>
          )}
          {holdings.data && holdings.data.length > 1 && (
            <p className="text-sm text-muted-foreground">
              Together <span className="data text-foreground">{fmtUsd(total)}</span>{" "}
              at today&apos;s prices, the portfolio value on your dashboard with All portfolios
              selected.
            </p>
          )}
      </Section>

      {accounts.data && accounts.data.length > 0 && (
        <Section title="What each account holds">
          {holdings.isLoading ? (
            <TabLoading label="Adding up each account…" className="h-24" />
          ) : holdings.isError ? (
            <TabError what="each account's holdings" onRetry={() => void holdings.refetch()} />
          ) : (
            <div className="grid grid-cols-1 gap-8">
              {accounts.data.map((a) => {
                const held = heldIn.get(a.id);
                const kind = TYPE_LABEL[typeOf.get(a.id) ?? "taxable"];
                return (
                  <div key={a.id} className="grid min-w-0 grid-cols-1 gap-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <h3 className="font-semibold">
                        {a.name}
                        <span className="ml-2 text-sm font-normal text-muted-foreground">
                          {kind}
                        </span>
                      </h3>
                      {held && (
                        <span className="data text-sm">
                          {fmtUsd(held.value)}
                          <span className="text-muted-foreground">
                            {" "}
                            · you paid {fmtUsd(held.costBasis)}
                          </span>
                        </span>
                      )}
                    </div>
                    {held && held.holdings.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="pl-1">Holding</TableHead>
                            {/* Fixed widths line the columns up across the accounts' tables */}
                            <TableHead className="hidden w-[20%] text-right sm:table-cell">
                              Units
                            </TableHead>
                            <TableHead className="w-[20%] text-right">You paid</TableHead>
                            <TableHead className="w-[20%] text-right">Value</TableHead>
                            <TableHead className="w-[20%] pr-1 text-right">Gain</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {held.holdings.map((h) => (
                              <TableRow key={h.assetId}>
                                <TableCell className="pl-1 font-medium">
                                  <Link
                                    href={`/positions/${h.assetId}`}
                                    className="hover:underline"
                                  >
                                    {h.symbol}
                                  </Link>
                                </TableCell>
                                <TableCell className="data hidden text-right sm:table-cell">
                                  {fmtQty(h.quantity)}
                                </TableCell>
                                <TableCell className="data text-right">
                                  {fmtUsd(h.costBasis)}
                                </TableCell>
                                <TableCell className="data text-right">
                                  {fmtUsd(h.marketValue)}
                                </TableCell>
                                <TableCell className={`data pr-1 text-right ${gainClass(h.gain)}`}>
                                  {fmtUsd(h.gain)}
                                </TableCell>
                              </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-muted-foreground">Nothing held here right now.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
