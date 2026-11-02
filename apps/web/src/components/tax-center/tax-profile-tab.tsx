"use client";

import {
  bracketOptions,
  FILING_STATUS_LABEL,
  ltcgZeroUpTo,
  ratesAtIncome,
  STANDARD_DEDUCTION,
  taxableFromPay,
  type FilingStatus,
} from "@beobeo/core/tax-brackets";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { usePortfolio } from "@/components/portfolio-context";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { LossRoomNote } from "@/components/tax-center/loss-room-note";
import { useIncome } from "@/components/tax-center/use-income";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TabError, TabLoading } from "@/components/tax-center/tab-state";
import { Switch } from "@/components/ui/switch";
import { Section } from "@/components/page-section";
import { lossRoom } from "@/lib/loss-room";
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

  // A toast carries the save, like the add-transaction form: a button sitting
  // on a greyed "Saving…" read as a hang, and nothing said it had landed
  // (samwell, mission 51). Repeat presses are ignored while one runs.
  function handleSave() {
    if (save.isPending) return;
    const toastId = toast.loading("Saving your tax profile…");
    save
      .mutateAsync(input())
      .then(() =>
        toast.success("Tax profile saved", {
          id: toastId,
          description: "Now, Raise Cash and Harvest Losses use these numbers.",
        }),
      )
      .catch((err: unknown) =>
        toast.error(`Couldn't save your tax profile: ${(err as Error).message}`, { id: toastId }),
      );
  }

  function input() {
    return {
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
    };
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
        <RatesCheck
          ordinary={n(fedOrdinary)}
          ltcg={n(fedLtcg)}
          onUse={(o, l) => {
            setFedOrdinary(String(o));
            setFedLtcg(String(l));
          }}
        />
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
        <LossRoomNote
          room={lossRoom({
            ytdShortTerm: n(ytdST) ?? 0,
            ytdLongTerm: n(ytdLT) ?? 0,
            carryShortTerm: n(carryST) ?? 0,
            carryLongTerm: n(carryLT) ?? 0,
          })}
          taxYear={initial.taxYear}
        />
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/accounts" className="text-sm text-muted-foreground hover:underline">
          Manage account types (taxable / IRA / 401k) →
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Rates, this year&apos;s totals and past losses save with this button
          </span>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Estimates based on simplified federal netting rules — not tax advice. Consult a tax
        advisor for your actual filing.
      </p>
    </div>
  );
}

/**
 * Says where the federal rates come from: with an income on the device, the
 * 2026 bracket it falls in, and a one-tap fix when the fields disagree.
 * Hermione's setup chose 24% at $250k joint pay (right: $217,800 taxable),
 * but nothing on this page said why, so she read it as wrong.
 */
function RatesCheck({
  ordinary,
  ltcg,
  onUse,
}: {
  ordinary: number | undefined;
  ltcg: number | undefined;
  onUse: (ordinary: number, ltcg: number) => void;
}) {
  const { income, complete } = useIncome();
  // A band tapped in setup, still under the filing status shown above:
  // "Setup filled these from the income band you picked" with no band named
  // left hermione unable to check them (mission 41).
  const band =
    !complete && income.band && income.band.status === (income.status ?? income.band.status)
      ? bracketOptions(income.band.status).find((b) => b.incomeFrom === income.band!.incomeFrom)
      : undefined;
  if (!complete && band) {
    const status = income.band!.status;
    const d = STANDARD_DEDUCTION[status];
    const matches = ordinary === band.ordinaryRatePct && ltcg === band.ltcgRatePct;
    const range = (shift: number) =>
      band.incomeTo === null
        ? `over ${fmtUsd(band.incomeFrom + shift, 0)}`
        : band.incomeFrom === 0
          ? `under ${fmtUsd(band.incomeTo + shift, 0)}`
          : `${fmtUsd(band.incomeFrom + shift, 0)} – ${fmtUsd(band.incomeTo + shift, 0)}`;
    return (
      <p className="text-xs text-muted-foreground">
        Setup set these from the band you picked: <span className="data">{range(0)}</span> of
        taxable income ({FILING_STATUS_LABEL[status].toLowerCase()}), which is pay of about{" "}
        <span className="data">{range(d)}</span>{" "}
        after the <span className="data">{fmtUsd(d, 0)}</span> standard deduction. 2026 brackets
        put that band at <span className="data">{band.ordinaryRatePct}%</span> on short-term gains
        and <span className="data">{band.ltcgRatePct}%</span> on long-term ones
        {matches ? ", which is what these say" : ""}.{" "}
        {!matches && (
          <>
            <button
              type="button"
              onClick={() => onUse(band.ordinaryRatePct, band.ltcgRatePct)}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Use {band.ordinaryRatePct}% / {band.ltcgRatePct}%
            </button>
            , then Save.{" "}
          </>
        )}
        Add your income above for an exact check.
      </p>
    );
  }
  if (!complete)
    return (
      <p className="text-xs text-muted-foreground">
        Setup filled these from the income band you picked, or 24% / 15% if you skipped it. Add
        your income above and we&apos;ll check them against the 2026 brackets.
      </p>
    );
  const at = ratesAtIncome(complete.status, complete.taxableIncomeUsd);
  const matches = ordinary === at.ordinaryRatePct && ltcg === at.ltcgRatePct;
  // The bracket's edges and the room to the next one, so the rate can be
  // checked against a tax table, not taken on trust (hermione, mission 47).
  const bands = bracketOptions(complete.status);
  const own = bands[at.band]!;
  const next = bands[at.band + 1];
  return (
    <p className="text-xs text-muted-foreground">
      At about <span className="data">{fmtUsd(complete.taxableIncomeUsd, 0)}</span> of taxable
      income ({FILING_STATUS_LABEL[complete.status].toLowerCase()}
      {income.payUsd != null && (
        <>
          , from pay of <span className="data">{fmtUsd(income.payUsd, 0)}</span>
        </>
      )}
      ), 2026 brackets put you at{" "}
      <span className="data">{at.ordinaryRatePct}%</span> on short-term gains and{" "}
      <span className="data">{at.ltcgRatePct}%</span> on long-term ones
      {matches ? ", which is what these say." : "."}{" "}
      {next && own.incomeTo !== null && (
        <>
          The {own.ordinaryRatePct}% bracket runs{" "}
          {own.incomeFrom === 0 ? (
            "up"
          ) : (
            <>
              from <span className="data">{fmtUsd(own.incomeFrom, 0)}</span>
            </>
          )}{" "}
          to <span className="data">{fmtUsd(own.incomeTo, 0)}</span>, so about{" "}
          <span className="data">{fmtUsd(own.incomeTo - complete.taxableIncomeUsd, 0)}</span>{" "}
          more taxable income before {next.ordinaryRatePct}%.
        </>
      )}
      {!matches && (
        <>
          {" "}
          <button
            type="button"
            onClick={() => onUse(at.ordinaryRatePct, at.ltcgRatePct)}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Use {at.ordinaryRatePct}% / {at.ltcgRatePct}%
          </button>
          , then Save.
        </>
      )}
    </p>
  );
}

const STATUS_OPTIONS: { value: FilingStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married_joint", label: "Married, jointly" },
  { value: "head_of_household", label: "Head of household" },
];

function parseAmount(v: string): number | null {
  const clean = v.replace(/[$,\s]/g, "");
  const amount = Number(clean);
  return clean === "" || !Number.isFinite(amount) || amount < 0 ? null : amount;
}

/**
 * Optional, saved on this device as you type (`useIncome`): the only thing it
 * changes is whether the Now tab can offer long-term gains at 0%. It asks for
 * pay, like setup, and says the taxable figure it works out: luna typed $55,000
 * in setup and found an unexplained "38900" here (mission 69). Anyone who
 * itemizes can type taxable income instead.
 */
function IncomeSection() {
  const { income, setIncome } = useIncome();
  const [byPay, setByPay] = useState(
    !(income.taxableIncomeUsd !== null && income.payUsd == null),
  );
  const shown = byPay ? (income.payUsd ?? null) : income.taxableIncomeUsd;
  const [text, setText] = useState(shown === null ? "" : String(shown));
  const status = income.status ?? "single";
  const top = ltcgZeroUpTo(status);
  const deduction = STANDARD_DEDUCTION[status];

  function onAmount(v: string) {
    setText(v);
    const amount = parseAmount(v);
    setIncome(
      byPay
        ? {
            ...income,
            status,
            payUsd: amount,
            taxableIncomeUsd: amount === null ? null : taxableFromPay(status, amount),
          }
        : { ...income, status, payUsd: null, taxableIncomeUsd: amount },
    );
  }

  function onStatus(s: FilingStatus) {
    // Pay stays what it is; its taxable part moves with the standard deduction.
    setIncome(
      byPay && income.payUsd != null
        ? { ...income, status: s, taxableIncomeUsd: taxableFromPay(s, income.payUsd) }
        : { ...income, status: s },
    );
  }

  function switchEntry() {
    const next = !byPay;
    setByPay(next);
    // Carry the figure across so switching never drops what was saved.
    const value = next ? (income.payUsd ?? null) : income.taxableIncomeUsd;
    setText(value === null ? "" : String(value));
  }

  return (
    <Section title="Your income">
      <p className="-mt-2 max-w-2xl text-sm text-muted-foreground">
        Optional. Long-term gains are taxed at 0% while your taxable income stays under{" "}
        <span className="data">{fmtUsd(top, 0)}</span> ({FILING_STATUS_LABEL[status].toLowerCase()}),
        so with a rough figure the Now tab can show gains you could take tax-free. Saved on this
        device as you type.
      </p>
      <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-end">
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">How you file</Label>
          <SegmentedControl
            value={status}
            onChange={onStatus}
            options={STATUS_OPTIONS}
          />
        </div>
        <div className="grid max-w-xs gap-1.5">
          <Label htmlFor="taxable-income" className="text-xs text-muted-foreground">
            {byPay
              ? "Your pay this year, roughly, before investment gains"
              : "Taxable income this year, before investment gains"}
          </Label>
          <div className="flex items-center gap-1.5">
            <Input
              id="taxable-income"
              value={text}
              onChange={(e) => onAmount(e.target.value)}
              inputMode="decimal"
              placeholder={byPay ? "e.g. 60000" : "e.g. 42000"}
              className="data"
            />
            <span className="text-xs text-muted-foreground">$</span>
          </div>
        </div>
      </div>
      {byPay && income.payUsd != null && income.taxableIncomeUsd !== null ? (
        <p className="text-sm">
          After the <span className="data">{fmtUsd(deduction, 0)}</span> standard deduction, about{" "}
          <span className="data">{fmtUsd(income.taxableIncomeUsd, 0)}</span> of your{" "}
          <span className="data">{fmtUsd(income.payUsd, 0)}</span> is taxable income, the figure the
          tax brackets use.
        </p>
      ) : !byPay && income.taxableIncomeUsd !== null ? (
        <p className="text-sm">
          That&apos;s pay of about{" "}
          <span className="data">{fmtUsd(income.taxableIncomeUsd + deduction, 0)}</span> with the{" "}
          <span className="data">{fmtUsd(deduction, 0)}</span> standard deduction.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {byPay
          ? "Taxable income is your pay minus the standard deduction. "
          : "Taxable income is pay and other income minus deductions. "}
        <button
          type="button"
          onClick={switchEntry}
          className="text-primary underline-offset-2 hover:underline"
        >
          {byPay ? "I itemize: enter taxable income instead" : "Enter my pay instead"}
        </button>
      </p>
    </Section>
  );
}

export function TaxProfileTab() {
  const profile = useProfileQuery();
  if (profile.isError && !profile.data)
    return <TabError what="your tax settings" onRetry={() => void profile.refetch()} />;
  if (!profile.data) return <TabLoading label="Loading your tax settings…" className="h-96" />;
  return (
    <div className="grid gap-10">
      <IncomeSection />
      <ProfileForm initial={profile.data} />
    </div>
  );
}
