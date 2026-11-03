"use client";

import { useQueryClient } from "@tanstack/react-query";
import { use, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-section";
import { usePortfolio } from "@/components/portfolio-context";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { AllLotsTab } from "@/components/tax-center/all-lots-tab";
import { HarvestTab } from "@/components/tax-center/harvest-tab";
import { NowTab } from "@/components/tax-center/now-tab";
import { RaiseCashTab } from "@/components/tax-center/raise-cash-tab";
import { TaxProfileTab } from "@/components/tax-center/tax-profile-tab";
import { useIncome } from "@/components/tax-center/use-income";
import { HARVEST_DEFAULT, HARVEST_KEY, type HarvestState } from "@/lib/harvest-state";
import {
  RAISE_CASH_DEFAULT,
  RAISE_CASH_KEY,
  raiseCashDoNotSell,
  type RaiseCashState,
} from "@/lib/raise-cash-state";
import { useTRPC } from "@/lib/trpc";
import { readStored } from "@/lib/use-stored-state";

type Tab = "now" | "cash" | "harvest" | "lots" | "profile";

const TABS: { value: Tab; label: string }[] = [
  { value: "now", label: "Now" },
  { value: "cash", label: "Raise Cash" },
  { value: "harvest", label: "Harvest Losses" },
  { value: "lots", label: "All Lots" },
  { value: "profile", label: "Tax Profile" },
];

const isTab = (v: unknown): v is Tab => TABS.some((t) => t.value === v);

/** `?tab=cash` deep-links a tab (also how the sim screenshots each one). */
export default function TaxCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const requested = use(searchParams).tab;
  const { activeName, portfolioId } = usePortfolio();
  const [tab, setTab] = useState<Tab>(isTab(requested) ? requested : "now");

  // Warm the other tabs while the first one is read, so a tab switch shows content
  // instead of a loading block (personas kept landing on that block and calling it broken).
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { complete: income } = useIncome();
  useEffect(() => {
    const scope = { portfolioId: portfolioId ?? undefined };
    const lotsOptions = trpc.tax.lots.queryOptions(scope);
    const first = Promise.all([
      queryClient.prefetchQuery(trpc.tax.now.queryOptions({ ...scope, income })),
      queryClient.prefetchQuery(lotsOptions),
      queryClient.prefetchQuery(trpc.tax.profile.queryOptions(scope)),
    ]);
    // Then Raise Cash's saved plan and Harvest, with the inputs those tabs will send
    // (the server reuses the lots it just loaded): both sat on a spinner after a tab
    // switch (petyr, mission 110). After the first batch, so they never slow it.
    void first.then(() => {
      const raise = readStored<RaiseCashState>(RAISE_CASH_KEY, RAISE_CASH_DEFAULT);
      if (raise.target !== null && raise.target > 0) {
        const lots = queryClient.getQueryData(lotsOptions.queryKey) ?? [];
        const accountId = lots.some((l) => l.accountId === raise.accountId)
          ? raise.accountId
          : undefined;
        void queryClient.prefetchQuery(
          trpc.tax.plan.queryOptions({
            ...scope,
            targetProceeds: raise.target,
            doNotSell: raiseCashDoNotSell(raise, [...new Set(lots.map((l) => l.symbol))].sort()),
            accountId,
          }),
        );
      }
      const { cap } = readStored<HarvestState>(HARVEST_KEY, HARVEST_DEFAULT);
      void queryClient.prefetchQuery(
        trpc.tax.harvest.queryOptions({ ...scope, lossCapUsd: cap ?? undefined }),
      );
    });
  }, [trpc, queryClient, portfolioId, income]);

  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-8">
      <div className="grid gap-4">
        <PageHeader
          title="Tax Center"
          subtitle={`${activeName} · what selling would cost you, and how to pay less`}
        />
        {/* Five tabs don't fit a phone: the row scrolls sideways instead of wrapping. */}
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <SegmentedControl value={tab} onChange={setTab} options={TABS} />
        </div>
      </div>

      {tab === "now" && <NowTab onNavigate={setTab} />}
      {tab === "cash" && <RaiseCashTab />}
      {tab === "harvest" && <HarvestTab />}
      {tab === "lots" && <AllLotsTab />}
      {tab === "profile" && <TaxProfileTab />}
    </div>
  );
}
