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
import { useId, useState } from "react";
import { toast } from "sonner";
import { usePortfolio } from "@/components/portfolio-context";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { LossRoomNote } from "@/components/tax-center/loss-room-note";
import { useIncome } from "@/components/tax-center/use-income";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TabError, TabLoading } from "@/components/tax-center/tab-state";
import { MetricHover } from "@/components/metric-hover";
import { Switch } from "@/components/ui/switch";
import { TooltipProvider } from "@/components/ui/tooltip";
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

/** The term behind a plain label (R-002): the label says "a year or less",
 *  the card names short-term gains and reads the user's own figure. */
type Explain = { term: string; insight: string; meaning: string };

function Field({
  label,
  value,
  onChange,
  suffix = "%",
  explain,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  explain?: Explain;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <div className="flex text-xs text-muted-foreground">
        {explain ? (
          <MetricHover label={label} {...explain}>
            <span className="underline decoration-dotted underline-offset-4">{label}</span>
          </MetricHover>
        ) : (
          <Label htmlFor={id} className="text-xs text-muted-foreground">
            {label}
          </Label>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          id={id}
          aria-label={label}
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

const pct = (v: string) => `${v.trim() === "" ? "0" : v.trim()}%`;
const usd = (v: string) => fmtUsd(Number(v.replace(/[^0-9.-]/g, "")) || 0);

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
  const [showDiscount, setShowDiscount] = useState(initial.carryforwardDiscountPct !== 70);
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
        <p className="-mt-2 max-w-2xl text-sm text-muted-foreground">
          A sale&apos;s gain is taxed at one of two rates, set by how long you owned what you
          sold: a year or less, or over a year (the lower rate). Tap a label for its tax name.
        </p>
        <HoldingsAge
          shortRate={pct(fedOrdinary)}
          longRate={pct(fedLtcg)}
          stateShort={n(stateOrdinary) ? pct(stateOrdinary) : null}
          stateLong={n(stateLtcg) ? pct(stateLtcg) : null}
        />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field
            label="Federal · a year or less"
            value={fedOrdinary}
            onChange={setFedOrdinary}
            explain={{
              term: "Short-term gains",
              insight: `Gains on things you owned a year or less are taxed at ${pct(fedOrdinary)}.`,
              meaning:
                "Tax forms call these short-term gains. They're taxed like your pay, at your income tax bracket.",
            }}
          />
          <Field
            label="Federal · over a year"
            value={fedLtcg}
            onChange={setFedLtcg}
            explain={{
              term: "Long-term gains (LTCG)",
              insight: `Gains on things you owned over a year are taxed at ${pct(fedLtcg)}.`,
              meaning:
                "Tax forms call these long-term capital gains. The rate is 0%, 15% or 20%, set by your taxable income.",
            }}
          />
          <Field
            label="State · a year or less"
            value={stateOrdinary}
            onChange={onStateOrdinaryChange}
            explain={{
              term: "State short-term rate",
              insight: `Your state takes ${pct(stateOrdinary)} of gains on things owned a year or less.`,
              meaning: "Your state's income tax rate. Use 0 if your state has no income tax.",
            }}
          />
          <Field
            label="State · over a year"
            value={stateLtcg}
            onChange={setStateLtcg}
            suffix={stateFlag ? "% (linked)" : "%"}
            explain={{
              term: "State long-term rate",
              insight: `Your state takes ${pct(stateLtcg)} of gains on things owned over a year.`,
              meaning: "Most states tax both kinds at the same rate; a few tax older gains less.",
            }}
          />
          <div className="col-span-2 flex items-center gap-2.5 md:col-span-4">
            <Switch
              checked={stateFlag}
              onCheckedChange={onToggleStateFlag}
              aria-label="My state taxes both at the same rate"
            />
            <span className="text-sm">
              My state taxes both at the same rate, however long I owned it
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
        <p className="-mt-2 max-w-2xl text-sm text-muted-foreground">
          What this year&apos;s sales gained (a minus for a loss), split by how long you owned
          what you sold.
        </p>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field
            label="Owned a year or less"
            value={ytdST}
            onChange={setYtdST}
            suffix="$"
            explain={{
              term: "Short-term gain/loss this year",
              insight: `${usd(ytdST)} from this year's sales of things owned a year or less.`,
              meaning: "Taxed at your rate for a year or less, after losses cancel what they can.",
            }}
          />
          <Field
            label="Owned over a year"
            value={ytdLT}
            onChange={setYtdLT}
            suffix="$"
            explain={{
              term: "Long-term gain/loss this year",
              insight: `${usd(ytdLT)} from this year's sales of things owned over a year.`,
              meaning: "Taxed at your lower over-a-year rate, after losses cancel what they can.",
            }}
          />
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
        <p className="-mt-2 max-w-2xl text-sm text-muted-foreground">
          Losses your earlier tax returns couldn&apos;t use up. They cancel this year&apos;s gains
          first, then up to <span className="data">$3,000</span> of pay a year. Leave them at 0 if
          you have none.
        </p>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field
            label="Owned a year or less"
            value={carryST}
            onChange={setCarryST}
            suffix="$"
            explain={{
              term: "Short-term loss carryforward",
              insight: `${usd(carryST)} of losses left over from things owned a year or less.`,
              meaning:
                "Last year's return lists it on the capital loss carryover worksheet. It cancels gains on things owned a year or less first.",
            }}
          />
          <Field
            label="Owned over a year"
            value={carryLT}
            onChange={setCarryLT}
            suffix="$"
            explain={{
              term: "Long-term loss carryforward",
              insight: `${usd(carryLT)} of losses left over from things owned over a year.`,
              meaning:
                "Last year's return lists it on the capital loss carryover worksheet. It cancels gains on things owned over a year first.",
            }}
          />
          {showDiscount && (
            <>
              <Field
                label="A loss saved for later counts"
                value={discount}
                onChange={setDiscount}
                explain={{
                  term: "Carryforward discount",
                  insight: `A loss that can only carry to next year counts as ${pct(discount)} of its tax value today.`,
                  meaning:
                    "It still saves tax, just later and less surely, so plans weigh it below a loss used this year.",
                }}
              />
              <div className="flex items-end pb-1.5 text-xs text-muted-foreground">
                of its full tax value, since a loss that only carries to next year saves tax
                later, not now.
              </div>
            </>
          )}
        </div>
        {!showDiscount && (
          // An expert setting (R-002): a 70 box nobody explained read as
          // homework to luna, so it stays one deliberate tap away.
          <p className="text-xs text-muted-foreground">
            Plans count a loss that carries to next year at{" "}
            <span className="data">{pct(discount)}</span> of its tax value, since it saves tax
            later, not now.{" "}
            <button
              type="button"
              onClick={() => setShowDiscount(true)}
              className="text-primary underline-offset-2 hover:underline"
            >
              Change it
            </button>
          </p>
        )}
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

/** "2027-08-02" → "Aug 2, 2027" */
const fullDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

/** "VOO", "VOO and NVDA", "VOO, NVDA and 2 more" */
function nameList(symbols: string[]): string {
  if (symbols.length <= 2) return symbols.join(" and ");
  if (symbols.length === 3) return `${symbols[0]}, ${symbols[1]} and ${symbols[2]}`;
  return `${symbols[0]}, ${symbols[1]} and ${symbols.length - 2} more`;
}

/**
 * Which of the two rates the user's own holdings get today, and when the
 * newer ones move to the lower rate. Luna saw 12% and 0% here but nothing
 * said her August buys would be taxed at 12% until Aug 2027 (mission 140).
 * Taxable accounts only (`tax.lots`, already in the page's first batch).
 */
function HoldingsAge({
  shortRate,
  longRate,
  stateShort,
  stateLong,
}: {
  shortRate: string;
  longRate: string;
  stateShort: string | null;
  stateLong: string | null;
}) {
  const trpc = useTRPC();
  const { portfolioId } = usePortfolio();
  const lots = useQuery(trpc.tax.lots.queryOptions({ portfolioId: portfolioId ?? undefined }));
  if (!lots.data || lots.data.length === 0) return null;

  const short = lots.data.filter((l) => !l.isLongTerm);
  const long = lots.data.filter((l) => l.isLongTerm);
  const sum = (ls: typeof short) => ls.reduce((s, l) => s + l.marketValue, 0);
  const symbols = (ls: typeof short) => [...new Set(ls.map((l) => l.symbol))];
  const rate = (fed: string, state: string | null) => (
    <>
      <span className="data">{fed}</span>
      {state && (
        <>
          {" "}
          plus <span className="data">{state}</span> state
        </>
      )}
    </>
  );
  // The earliest date each holding's newer purchases pass a year, soonest first.
  const firstLong = new Map<string, string>();
  for (const l of short) {
    const at = firstLong.get(l.symbol);
    if (!at || l.longTermOn < at) firstLong.set(l.symbol, l.longTermOn);
  }
  // Holdings bought the same day share one date ("Aug 4, 2027 for VOO and NVDA").
  const byDate = new Map<string, string[]>();
  for (const [symbol, on] of firstLong) byDate.set(on, [...(byDate.get(on) ?? []), symbol]);
  const all = [...byDate].sort((a, b) => a[0].localeCompare(b[0]));
  const upcoming = all.slice(0, 3);
  const dates = upcoming.length > 0 && (
    <>
      {" "}
      The next purchases to pass a year:{" "}
      {upcoming.map(([on, syms], i) => (
        <span key={on}>
          {i > 0 && (i === upcoming.length - 1 ? " and " : ", ")}
          {nameList(syms)} on <span className="data">{fullDay(on)}</span>
        </span>
      ))}
      {all.length > upcoming.length && ", the rest later"}. From then, selling those gets the
      over-a-year rate, {rate(longRate, stateLong)}.
    </>
  );

  return (
    <p className="max-w-2xl text-sm">
      {long.length === 0 ? (
        <>
          Everything you own in taxable accounts ({nameList(symbols(short))}) is a year old or
          less, so selling it today would be taxed at {rate(shortRate, stateShort)}.
        </>
      ) : short.length === 0 ? (
        <>
          Everything you own in taxable accounts ({nameList(symbols(long))}) is owned over a year,
          so selling it today would be taxed at {rate(longRate, stateLong)}.
        </>
      ) : (
        <>
          Of what you own in taxable accounts, <span className="data">{fmtUsd(sum(long))}</span>{" "}
          is owned over a year (taxed at {rate(longRate, stateLong)} if sold today) and{" "}
          <span className="data">{fmtUsd(sum(short))}</span> a year or less (
          {rate(shortRate, stateShort)}).
        </>
      )}
      {dates}
    </p>
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
        put that band at <span className="data">{band.ordinaryRatePct}%</span> on things owned a
        year or less and <span className="data">{band.ltcgRatePct}%</span> on things owned longer
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
      At <span className="data">{fmtUsd(complete.taxableIncomeUsd, 0)}</span> of taxable
      income ({FILING_STATUS_LABEL[complete.status].toLowerCase()}
      {income.payUsd != null && (
        <>
          , from pay of <span className="data">{fmtUsd(income.payUsd, 0)}</span>
        </>
      )}
      ), 2026 brackets put you at{" "}
      <span className="data">{at.ordinaryRatePct}%</span> on things owned a year or less and{" "}
      <span className="data">{at.ltcgRatePct}%</span> on things owned longer
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
          to <span className="data">{fmtUsd(own.incomeTo, 0)}</span>, so{" "}
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
        Optional. Gains on things owned over a year are taxed at 0% while your taxable income stays under{" "}
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
          After the <span className="data">{fmtUsd(deduction, 0)}</span> standard deduction,{" "}
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
    <TooltipProvider delayDuration={150}>
      <div className="grid gap-10">
        <IncomeSection />
        <ProfileForm initial={profile.data} />
      </div>
    </TooltipProvider>
  );
}
