"use client";

import { useQuery } from "@tanstack/react-query";
import { usePortfolio } from "@/components/portfolio-context";
import { fmtUsd } from "@/lib/viz";
import { useTRPC } from "@/lib/trpc";

export interface PortfolioSplit {
  /** Each portfolio that holds something, in the switcher's order. */
  parts: { id: string; name: string; value: number }[];
  /** Asset id → names of the portfolios holding it. */
  byAsset: Map<string, string[]>;
}

/**
 * With "All portfolios" picked and money in two or more of them, how the
 * total splits by portfolio, from each account's holdings (the Accounts
 * page's figures, which add up to the dashboard's value). molly keeps her
 * daughter's UTMA as its own portfolio and read the combined $51,304 as
 * Ginny's money "mashed into ours" with nothing saying so. Null otherwise.
 */
export function usePortfolioSplit(): PortfolioSplit | null {
  const trpc = useTRPC();
  const { portfolioId, portfolios } = usePortfolio();
  const on = portfolioId === null && portfolios.length > 1;
  const accounts = useQuery({ ...trpc.accounts.list.queryOptions({}), enabled: on });
  const holdings = useQuery({ ...trpc.accounts.holdings.queryOptions({}), enabled: on });
  if (!on || !accounts.data || !holdings.data) return null;

  const portfolioOf = new Map(accounts.data.map((a) => [a.id, a.portfolioId]));
  const value = new Map<string, number>();
  const assetIn = new Map<string, Set<string>>();
  for (const account of holdings.data) {
    const pid = portfolioOf.get(account.accountId);
    if (!pid) continue;
    value.set(pid, (value.get(pid) ?? 0) + account.value);
    for (const h of account.holdings) {
      const set = assetIn.get(h.assetId) ?? new Set<string>();
      set.add(pid);
      assetIn.set(h.assetId, set);
    }
  }
  const parts = portfolios
    .filter((p) => value.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, value: Math.round(value.get(p.id)! * 100) / 100 }));
  if (parts.length < 2) return null;
  const order = parts.map((p) => p.id);
  const byAsset = new Map(
    [...assetIn].map(([assetId, ids]) => [
      assetId,
      order.filter((id) => ids.has(id)).map((id) => parts.find((p) => p.id === id)!.name),
    ]),
  );
  return { parts, byAsset };
}

/** "This adds up all your portfolios: Main $43,528.37 + Ginny $7,775.41." Each name switches to it. */
export function PortfolioSplitNote({ split }: { split: PortfolioSplit }) {
  const { setPortfolioId } = usePortfolio();
  return (
    <p className="basis-full text-sm text-muted-foreground">
      This adds up all your portfolios:{" "}
      {split.parts.map((p, i) => (
        <span key={p.id}>
          {i > 0 && " + "}
          <button
            type="button"
            onClick={() => setPortfolioId(p.id)}
            className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
          >
            {p.name}
          </button>{" "}
          <span className="data text-foreground">{fmtUsd(p.value)}</span>
        </span>
      ))}
      . Tap one to see it on its own.
    </p>
  );
}
