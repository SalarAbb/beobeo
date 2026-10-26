"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useSyncExternalStore } from "react";
import { useTRPC } from "@/lib/trpc";

const STORAGE_KEY = "beobeo.activePortfolioId";

// Tiny external store over localStorage — no setState-in-effect, SSR-safe
// (server snapshot is null → first paint shows "All portfolios").
const listeners = new Set<() => void>();
const portfolioStore = {
  get: (): string | null =>
    typeof window === "undefined" ? null : localStorage.getItem(STORAGE_KEY),
  set: (id: string | null) => {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
    listeners.forEach((l) => l());
  },
  subscribe: (cb: () => void) => {
    listeners.add(cb);
    window.addEventListener("storage", cb); // cross-tab sync
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", cb);
    };
  },
};

interface PortfolioContextValue {
  /** null = all portfolios combined. */
  portfolioId: string | null;
  setPortfolioId: (id: string | null) => void;
  portfolios: { id: string; name: string }[];
  /** Name of the active portfolio ("All portfolios" when null). */
  activeName: string;
  /** Signed-in user, for per-user device storage (allocation targets). */
  userId: string;
}

const PortfolioContext = createContext<PortfolioContextValue>({
  portfolioId: null,
  setPortfolioId: () => {},
  portfolios: [],
  activeName: "All portfolios",
  userId: "",
});

export function PortfolioProvider({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  const trpc = useTRPC();
  const portfolios = useQuery(trpc.portfolios.list.queryOptions());
  const stored = useSyncExternalStore(
    portfolioStore.subscribe,
    portfolioStore.get,
    () => null,
  );

  // Derived at render: a stored id pointing at a deleted portfolio acts as
  // "All portfolios" (the stale key is overwritten on the next selection).
  const portfolioId =
    stored && portfolios.data && !portfolios.data.some((p) => p.id === stored)
      ? null
      : stored;

  const activeName =
    (portfolioId
      ? portfolios.data?.find((p) => p.id === portfolioId)?.name
      : null) ?? "All portfolios";

  return (
    <PortfolioContext.Provider
      value={{
        portfolioId,
        setPortfolioId: portfolioStore.set,
        portfolios: portfolios.data ?? [],
        activeName,
        userId,
      }}
    >
      {children}
    </PortfolioContext.Provider>
  );
}

export const usePortfolio = () => useContext(PortfolioContext);
