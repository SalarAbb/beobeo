"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, Section } from "@/components/page-section";
import { usePortfolio } from "@/components/portfolio-context";
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
import { toast } from "sonner";
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

// How the broker picks which purchases a sale uses. Every gain in the app
// follows it; crypto exchanges often use highest cost first.
const LOT_METHOD_LABEL = {
  fifo: "oldest first",
  hifo: "highest cost first",
} as const;
type LotMethod = keyof typeof LOT_METHOD_LABEL;

export default function AccountsPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { portfolioId, activeName } = usePortfolio();
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
  const move = useMutation(trpc.accounts.update.mutationOptions());
  // A new matching method changes every gain, cost and tax figure.
  const setLotMethod = useMutation(
    trpc.accounts.update.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries(),
    }),
  );
  // Moving an account between portfolios is only a choice once there are two.
  const canMove = (portfolios.data?.length ?? 0) > 1;
  const byPortfolio = (portfolios.data ?? []).map((p) => {
    const inIt = (accounts.data ?? []).filter((a) => a.portfolioId === p.id);
    return {
      ...p,
      accounts: inIt.length,
      value: inIt.reduce((s, a) => s + (heldIn.get(a.id)?.value ?? 0), 0),
    };
  });
  const filledPortfolios = byPortfolio.filter((p) => p.accounts > 0);
  const emptyPortfolios = byPortfolio.filter((p) => p.accounts === 0);

  /** Moves an account (and with it every trade in it) into another portfolio.
   *  A new portfolio used to stay empty with no way to fill it (barristan,
   *  mission 120). The list updates at once; "Undo" moves it back. */
  async function moveAccount(id: string, to: string, undoing = false) {
    const account = accounts.data?.find((a) => a.id === id);
    if (!account || account.portfolioId === to) return;
    const from = account.portfolioId;
    const listKey = trpc.accounts.list.queryKey({});
    const setPortfolio = (portfolioId: string | null) =>
      queryClient.setQueryData(listKey, (old) =>
        old?.map((a) => (a.id === id ? { ...a, portfolioId } : a)),
      );
    setPortfolio(to);
    const toName = portfolioName.get(to) ?? "that portfolio";
    const toastId = toast.loading(`Moving ${account.name} to ${toName}…`);
    try {
      await move.mutateAsync({ id, portfolioId: to });
    } catch (err) {
      setPortfolio(from);
      toast.error(`Couldn't move ${account.name}: ${(err as Error).message}`, { id: toastId });
      return;
    }
    const held = heldIn.get(id);
    toast.success(
      undoing ? `${account.name} is back in ${toName}` : `${account.name} is now in ${toName}`,
      {
        id: toastId,
        description:
          held && held.value > 0
            ? `Its ${fmtUsd(held.value)} and every trade in it count there now. Pick ${toName} in the portfolio switcher to see it on its own.`
            : "Every trade in it counts there now.",
        action:
          !undoing && from
            ? { label: "Undo", onClick: () => void moveAccount(id, from, true) }
            : undefined,
      },
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.accounts.pathKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.transactions.pathKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.portfolio.pathKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.tax.pathKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.compare.pathKey() }),
    ]);
  }

  // One account can hold stocks and crypto, and brokers often match them
  // differently (stocks oldest first, crypto highest cost first).
  const lotMethodSelect = (
    a: { id: string; name: string; lotMethod: LotMethod; cryptoLotMethod: LotMethod },
    field: "lotMethod" | "cryptoLotMethod",
    kind: string,
    shortKind: string,
  ) => (
    <Select
      value={a[field]}
      onValueChange={(m) => setLotMethod.mutate({ id: a.id, [field]: m as LotMethod })}
    >
      <SelectTrigger
        size="sm"
        className="mt-1.5 ml-auto w-48 sm:w-60"
        aria-label={`How ${a.name} matches ${kind.toLowerCase()} sales to purchases`}
      >
        <span className="text-muted-foreground">
          <span className="hidden sm:inline">{kind}:</span>
          <span className="sm:hidden">{shortKind}:</span>
        </span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {Object.entries(LOT_METHOD_LABEL).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const portfolioSelect = (a: { id: string; name: string; portfolioId: string | null }) => (
    <Select value={a.portfolioId ?? undefined} onValueChange={(to) => void moveAccount(a.id, to)}>
      <SelectTrigger size="sm" className="w-40" aria-label={`Portfolio for ${a.name}`}>
        <SelectValue placeholder="Pick one" />
      </SelectTrigger>
      <SelectContent>
        {(portfolios.data ?? []).map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-12">
      <PageHeader
        title="Accounts"
        subtitle={
          "Flag which accounts are taxable brokerages vs. tax-advantaged (IRA, 401k) — " +
          "the Tax Center only sells from taxable accounts, and checks every account " +
          "here for a recent buy that would stop a loss from counting. Set how each account " +
          "matches a sale to your purchases the way your broker does (most use oldest first; " +
          "many crypto exchanges use highest cost first), so your gains match its tax forms." +
          (canMove ? " Pick each account's portfolio to see it on its own in the switcher." : "")
        }
      />

      <Section title="Your accounts">
          {/* This page lists every account whatever the switcher says; picking
              a portfolio there and seeing nothing change read as "the switch
              didn't take" (barristan, mission 124). */}
          {portfolioId && canMove && accounts.data && (
            <p className="text-sm text-muted-foreground">
              Every account is listed here, whichever portfolio is picked. {activeName}{" "}
              {(() => {
                const inIt = accounts.data.filter((a) => a.portfolioId === portfolioId);
                return inIt.length > 0
                  ? `holds ${inIt.map((a) => a.name).join(", ")}.`
                  : "has none yet.";
              })()}
            </p>
          )}
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
                  <TableHead className="pr-1 text-right">Type · how sales are matched</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.data.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="pl-1 font-medium">
                      {a.name}
                      {/* Phones have no Portfolio column; the picker sits under the name */}
                      {canMove && <div className="mt-1.5 sm:hidden">{portfolioSelect(a)}</div>}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {a.institution ?? "—"}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {canMove
                        ? portfolioSelect(a)
                        : a.portfolioId
                          ? (portfolioName.get(a.portfolioId) ?? "—")
                          : "—"}
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
                        <SelectTrigger size="sm" className="ml-auto w-48 sm:w-60">
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
                      {lotMethodSelect(a, "lotMethod", "Stocks & funds", "Stocks")}
                      {lotMethodSelect(a, "cryptoLotMethod", "Crypto", "Crypto")}
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
              selected
              {filledPortfolios.length > 1 ? (
                <>
                  :{" "}
                  {filledPortfolios.map((p, i) => (
                    <span key={p.id}>
                      {i > 0 && " · "}
                      {p.name} <span className="data text-foreground">{fmtUsd(p.value)}</span>
                    </span>
                  ))}
                  .
                </>
              ) : (
                "."
              )}
            </p>
          )}
          {canMove && accounts.data && accounts.data.length > 0 && emptyPortfolios.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {emptyPortfolios.map((p) => p.name).join(", ")}{" "}
              {emptyPortfolios.length === 1 ? "has" : "have"} no accounts yet. Pick{" "}
              {emptyPortfolios.length === 1 ? "it" : "one"} in an account&apos;s Portfolio box
              above to move that account, with every trade in it, there.
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
