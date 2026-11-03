"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { usePortfolio } from "@/components/portfolio-context";
import { useIncome } from "@/components/tax-center/use-income";
import {
  COMPARE_KEYS,
  activeBenchmarkIds,
  benchmarkChips,
  dcaInput,
  type BenchAsset,
} from "@/lib/compare-selection";
import { useTRPC } from "@/lib/trpc";
import { readStored } from "@/lib/use-stored-state";

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/transactions", label: "Transactions" },
  { href: "/tax-center", label: "Tax Center" },
  { href: "/compare", label: "Compare" },
  { href: "/chat", label: "Chat" },
  { href: "/accounts", label: "Accounts" },
];

/** Primary navigation: a vertical list in the desktop sidebar, a horizontally
 *  scrolling row under the top bar on phones. The current page is tinted
 *  with the accent. */
export function AppNav() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { portfolioId } = usePortfolio();
  const { complete: income } = useIncome();
  // Start a page's data on the way to the click, so it arrives with the page
  // instead of after it (the transactions list sat on a loading state).
  const warm: Record<string, () => void> = {
    "/transactions": () => {
      const scope = { portfolioId: portfolioId ?? undefined };
      void queryClient.prefetchQuery(trpc.transactions.list.queryOptions({ limit: 200, ...scope }));
      void queryClient.prefetchQuery(trpc.accounts.list.queryOptions(scope));
      void queryClient.prefetchQuery(trpc.transactions.assets.queryOptions(scope));
    },
    // The same three queries the page fires on mount (with the device's income).
    "/tax-center": () => {
      const scope = { portfolioId: portfolioId ?? undefined };
      void queryClient.prefetchQuery(trpc.tax.now.queryOptions({ ...scope, income }));
      void queryClient.prefetchQuery(trpc.tax.lots.queryOptions(scope));
      void queryClient.prefetchQuery(trpc.tax.profile.queryOptions(scope));
    },
    // Coming back from the Tax Center, the list sat on its loading state
    // (barristan, mission 137).
    "/accounts": () => {
      void queryClient.prefetchQuery(trpc.accounts.list.queryOptions({}));
      void queryClient.prefetchQuery(trpc.portfolios.list.queryOptions());
      void queryClient.prefetchQuery(trpc.accounts.holdings.queryOptions({}));
    },
    // The comparison the page will ask for, with the benchmarks and scope saved on the device.
    "/compare": () => {
      void queryClient.prefetchQuery(trpc.portfolio.overview.queryOptions({ portfolioId: portfolioId ?? undefined }));
      void queryClient
        .fetchQuery({ ...trpc.compare.presets.queryOptions(), staleTime: Infinity })
        .then((presets) => {
          const chips = benchmarkChips(presets, readStored<BenchAsset[]>(COMPARE_KEYS.custom, []));
          const ids = activeBenchmarkIds(presets, chips, readStored<string[] | null>(COMPARE_KEYS.selected, null));
          if (ids.length === 0) return;
          const scope = readStored<string[]>(COMPARE_KEYS.scope(portfolioId), []);
          return queryClient.prefetchQuery({
            ...trpc.compare.dca.queryOptions(dcaInput(ids, scope, portfolioId)),
            staleTime: 5 * 60_000,
          });
        })
        .catch(() => {}); // the page loads it itself
    },
  };
  // Once the dashboard has finished loading and sat idle, start the Tax
  // Center's data too (once per scope: only while nothing is cached), so the
  // usual next stop opens with its answer. Right after setup it opened on
  // "Working out your tax picture…" (hermione, mission 72); a hover only
  // starts it a moment before the click.
  const fetching = useIsFetching();
  useEffect(() => {
    if (pathname !== "/dashboard" || fetching > 0) return;
    const input = { portfolioId: portfolioId ?? undefined, income };
    if (queryClient.getQueryState(trpc.tax.now.queryKey(input))) return;
    const timer = setTimeout(() => {
      void queryClient.prefetchQuery(trpc.tax.now.queryOptions(input));
      void queryClient.prefetchQuery(trpc.tax.lots.queryOptions({ portfolioId: input.portfolioId }));
      void queryClient.prefetchQuery(trpc.tax.profile.queryOptions({ portfolioId: input.portfolioId }));
    }, 1500);
    return () => clearTimeout(timer);
  }, [pathname, fetching, portfolioId, income, queryClient, trpc]);
  // On phones the row scrolls; keep the current page's tab visible.
  useEffect(() => {
    navRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);
  return (
    <nav
      ref={navRef}
      aria-label="Main"
      className="flex gap-1 overflow-x-auto px-3 pb-2 md:flex-col md:overflow-visible md:pb-0"
    >
      {nav.map((item) => {
        const active =
          pathname === item.href ||
          pathname.startsWith(`${item.href}/`) ||
          (item.href === "/dashboard" && pathname.startsWith("/positions/"));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            onPointerEnter={warm[item.href]}
            onFocus={warm[item.href]}
            onTouchStart={warm[item.href]}
            className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors ${
              active
                ? "bg-sidebar-accent font-medium text-primary"
                : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
