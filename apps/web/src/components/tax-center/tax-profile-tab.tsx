"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { usePortfolio } from "@/components/portfolio-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TabError, TabLoading } from "@/components/tax-center/tab-state";
import { Switch } from "@/components/ui/switch";
import { Section } from "@/components/page-section";
import { useTRPC } from "@/lib/trpc";
import { fmtUsd } from "@/lib/viz";

type Profile = ReturnType<typeof useProfileQuery>["data"];

function useProfileQuery() {
  const trpc = useTRPC();
  const { portfolioId } = usePortfolio();
  return useQuery(trpc.tax.profile.queryOptions({ portfolioId: portfolioId ?? undefined }));
}

function Field({
  label,
  value,
  onChange,
  suffix = "%",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1.5">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          className="data"
        />
        <span className="text-xs text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );
}

/** Mounted only once `initial` has loaded — useState's lazy initializer
 *  derives the form from it exactly once, no effect-based resync needed. */
function ProfileForm({ initial }: { initial: NonNullable<Profile> }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { portfolioId } = usePortfolio();

  const [fedOrdinary, setFedOrdinary] = useState(String(initial.federalOrdinaryRatePct));
  const [fedLtcg, setFedLtcg] = useState(String(initial.federalLtcgRatePct));
  const [stateOrdinary, setStateOrdinary] = useState(String(initial.stateOrdinaryRatePct));
  const [stateLtcg, setStateLtcg] = useState(String(initial.stateLtcgRatePct));
  const [stateFlag, setStateFlag] = useState(initial.stateTreatsLtcgAsOrdinary);
  const [carryST, setCarryST] = useState(String(initial.carryforwardShortTerm));
  const [carryLT, setCarryLT] = useState(String(initial.carryforwardLongTerm));
  const [discount, setDiscount] = useState(String(initial.carryforwardDiscountPct));
  // Dollars to the cent: the computed value carries 8 decimals of float noise.
  const cents = (v: number) => String(Math.round(v * 100) / 100);
  const [ytdST, setYtdST] = useState(
    cents(initial.ytdShortTermOverride ?? initial.ytdShortTermComputed),
  );
  const [ytdLT, setYtdLT] = useState(
    cents(initial.ytdLongTermOverride ?? initial.ytdLongTermComputed),
  );

  const save = useMutation(
    trpc.tax.updateProfile.mutationOptions({
      onSuccess: () => {
        // Rates changed -> every tax computation for this scope is stale.
        void queryClient.invalidateQueries({ queryKey: trpc.tax.profile.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.tax.now.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.tax.plan.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.tax.harvest.queryKey() });
      },
    }),
  );

  const n = (s: string): number | undefined => {
    const v = Number(s.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(v) ? v : undefined;
  };

  function onToggleStateFlag(checked: boolean) {
    setStateFlag(checked);
    if (checked) setStateLtcg(stateOrdinary);
  }
  function onStateOrdinaryChange(v: string) {
    setStateOrdinary(v);
    if (stateFlag) setStateLtcg(v);
  }

  function handleSave() {
    save.mutate({
      portfolioId: portfolioId ?? undefined,
      federalOrdinaryRatePct: n(fedOrdinary),
      federalLtcgRatePct: n(fedLtcg),
      stateOrdinaryRatePct: n(stateOrdinary),
      stateLtcgRatePct: n(stateLtcg),
      stateTreatsLtcgAsOrdinary: stateFlag,
      carryforwardShortTerm: n(carryST),
      carryforwardLongTerm: n(carryLT),
      carryforwardDiscountPct: n(discount),
      ytdShortTermOverride: n(ytdST),
      ytdLongTermOverride: n(ytdLT),
    });
  }

  return (
    <div className="grid gap-10">
      <Section title="Tax rates">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="Federal ordinary" value={fedOrdinary} onChange={setFedOrdinary} />
          <Field label="Federal long-term (LTCG)" value={fedLtcg} onChange={setFedLtcg} />
          <Field label="State ordinary" value={stateOrdinary} onChange={onStateOrdinaryChange} />
          <Field
            label="State long-term (LTCG)"
            value={stateLtcg}
            onChange={setStateLtcg}
            suffix={stateFlag ? "% (linked)" : "%"}
          />
          <div className="col-span-2 flex items-center gap-2.5 md:col-span-4">
            <Switch checked={stateFlag} onCheckedChange={onToggleStateFlag} />
            <span className="text-sm">
              My state taxes long-term gains at the same rate as ordinary income
            </span>
          </div>
        </div>
      </Section>

      <Section title="This year so far">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="YTD short-term gain/loss" value={ytdST} onChange={setYtdST} suffix="$" />
          <Field label="YTD long-term gain/loss" value={ytdLT} onChange={setYtdLT} suffix="$" />
          <div className="col-span-2 flex items-end pb-1.5 text-xs text-muted-foreground md:col-span-2">
            <span>
              Pre-filled from your tracked sales (
              <span className="data">{fmtUsd(initial.ytdShortTermComputed, 0)}</span> /{" "}
              <span className="data">{fmtUsd(initial.ytdLongTermComputed, 0)}</span>). Edit if
              you have gains elsewhere.
            </span>
          </div>
        </div>
      </Section>

      <Section title="Losses from past years">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="Short-term carryforward" value={carryST} onChange={setCarryST} suffix="$" />
          <Field label="Long-term carryforward" value={carryLT} onChange={setCarryLT} suffix="$" />
          <Field label="Carryforward discount" value={discount} onChange={setDiscount} />
          <div className="flex items-end pb-1.5 text-xs text-muted-foreground">
            How much a loss that only carries forward (doesn&apos;t offset anything this
            year) is worth today — real value, just deferred and uncertain.
          </div>
        </div>
      </Section>

      <div className="flex items-center justify-between">
        <Link href="/accounts" className="text-sm text-muted-foreground hover:underline">
          Manage account types (taxable / IRA / 401k) →
        </Link>
        <Button onClick={handleSave} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Estimates based on simplified federal netting rules — not tax advice. Consult a tax
        advisor for your actual filing.
      </p>
    </div>
  );
}

export function TaxProfileTab() {
  const profile = useProfileQuery();
  if (profile.isError && !profile.data)
    return <TabError what="your tax settings" onRetry={() => void profile.refetch()} />;
  if (!profile.data) return <TabLoading label="Loading your tax settings…" className="h-96" />;
  return <ProfileForm initial={profile.data} />;
}
