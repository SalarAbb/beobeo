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
import { useTRPC } from "@/lib/trpc";

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
    void queryClient.prefetchQuery(trpc.tax.now.queryOptions({ ...scope, income }));
    void queryClient.prefetchQuery(trpc.tax.lots.queryOptions(scope));
    void queryClient.prefetchQuery(trpc.tax.profile.queryOptions(scope));
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
