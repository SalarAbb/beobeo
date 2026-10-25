"use client";

import { useState } from "react";
import { usePortfolio } from "@/components/portfolio-context";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { AllLotsTab } from "@/components/tax-center/all-lots-tab";
import { HarvestTab } from "@/components/tax-center/harvest-tab";
import { NowTab } from "@/components/tax-center/now-tab";
import { RaiseCashTab } from "@/components/tax-center/raise-cash-tab";
import { TaxProfileTab } from "@/components/tax-center/tax-profile-tab";

type Tab = "now" | "cash" | "harvest" | "lots" | "profile";

const TABS: { value: Tab; label: string }[] = [
  { value: "now", label: "Now" },
  { value: "cash", label: "Raise Cash" },
  { value: "harvest", label: "Harvest Losses" },
  { value: "lots", label: "All Lots" },
  { value: "profile", label: "Tax Profile" },
];

export default function TaxCenterPage() {
  const { activeName } = usePortfolio();
  const [tab, setTab] = useState<Tab>("now");

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-3xl">Tax Center</h1>
        <span className="text-sm text-muted-foreground">· {activeName}</span>
        <div className="ml-auto">
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
