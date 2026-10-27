"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, FileUp, PenLine, ArrowRight } from "lucide-react";
import {
  bracketOptions,
  type BracketOption,
  type FilingStatus,
} from "@beobeo/core/tax-brackets";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useTRPC } from "@/lib/trpc";

const STATUS_OPTIONS: { value: FilingStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married_joint", label: "Married, jointly" },
  { value: "head_of_household", label: "Head of household" },
];

type AccountType = "taxable" | "traditional_ira" | "roth_ira" | "401k";

/** The accounts most people have; each tap becomes one account. */
const ACCOUNT_PRESETS: { name: string; type: AccountType; hint: string }[] = [
  { name: "Brokerage", type: "taxable", hint: "taxable" },
  { name: "Crypto exchange", type: "taxable", hint: "taxable" },
  { name: "Roth IRA", type: "roth_ira", hint: "tax-free" },
  { name: "Traditional IRA", type: "traditional_ira", hint: "tax-deferred" },
  { name: "401(k)", type: "401k", hint: "tax-deferred" },
];

const TYPE_LABEL: Record<string, string> = {
  taxable: "taxable",
  traditional_ira: "Traditional IRA",
  roth_ira: "Roth IRA",
  "401k": "401(k)",
  other_tax_advantaged: "tax-advantaged",
};

const k = (n: number) =>
  n >= 1000 ? `$${Math.round(n / 1000).toLocaleString("en-US")}k` : `$${n}`;

function bandLabel(b: BracketOption) {
  if (b.incomeFrom === 0) return `Under ${k(b.incomeTo!)}`;
  if (b.incomeTo === null) return `Over ${k(b.incomeFrom)}`;
  return `${k(b.incomeFrom)} – ${k(b.incomeTo)}`;
}

/** Selected rows/chips: the accent pill look used across the app. */
const choice = (on: boolean) =>
  `rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
    on ? "border-primary/40 bg-accent text-primary" : "hover:bg-muted"
  }`;

export function WelcomeFlow({ name }: { name: string }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const first = name.trim().split(/\s+/)[0] ?? "";

  if (step === 1) return <TaxStep first={first} onDone={() => setStep(2)} />;
  if (step === 2) return <AccountsStep onDone={() => setStep(3)} />;
  return <FirstHoldingStep />;
}

function StepFooter({ onSkip, label = "Skip this step" }: { onSkip: () => void; label?: string }) {
  return (
    <>
      Everything here can be changed later.{" "}
      <button
        type="button"
        onClick={onSkip}
        className="font-medium text-primary underline-offset-4 hover:underline"
      >
        {label}
      </button>
    </>
  );
}

function TaxStep({ first, onDone }: { first: string; onDone: () => void }) {
  const trpc = useTRPC();
  const [status, setStatus] = useState<FilingStatus>("single");
  const [band, setBand] = useState<number | null>(null);
  const [stateRate, setStateRate] = useState("");
  const save = useMutation(trpc.tax.updateProfile.mutationOptions({ onSuccess: onDone }));
  const bands = bracketOptions(status);
  const picked = band === null ? null : bands[band];
  const statePct = Number(stateRate);
  const stateOk = stateRate.trim() === "" || (Number.isFinite(statePct) && statePct >= 0 && statePct <= 20);

  function onContinue() {
    if (!picked && stateRate.trim() === "") return onDone();
    save.mutate({
      ...(picked && {
        federalOrdinaryRatePct: picked.ordinaryRatePct,
        federalLtcgRatePct: picked.ltcgRatePct,
      }),
      // Most states tax gains like any other income.
      ...(stateRate.trim() !== "" && {
        stateOrdinaryRatePct: statePct,
        stateLtcgRatePct: statePct,
        stateTreatsLtcgAsOrdinary: true,
      }),
    });
  }

  return (
    <AuthShell
      tagline="Step 1 of 3 · Taxes"
      title={first ? `Welcome, ${first}` : "Welcome"}
      subtitle="Roughly what you earn sets what a sale costs you in tax. A ballpark is enough; we never ask for exact income."
      footer={<StepFooter onSkip={onDone} />}
    >
      <div className="grid gap-2">
        <Label>How you file</Label>
        <SegmentedControl
          value={status}
          onChange={(s) => setStatus(s)}
          options={STATUS_OPTIONS}
        />
      </div>
      <div className="grid gap-2">
        <Label id="band-label">Taxable income this year, roughly</Label>
        <div role="radiogroup" aria-labelledby="band-label" className="grid gap-1.5">
          {bands.map((b, i) => (
            <button
              key={b.ordinaryRatePct}
              type="button"
              role="radio"
              aria-checked={band === i}
              onClick={() => setBand(band === i ? null : i)}
              className={`${choice(band === i)} flex items-center justify-between gap-3`}
            >
              <span className="data font-medium">{bandLabel(b)}</span>
              <span className="data text-xs text-muted-foreground">
                {b.ordinaryRatePct}% bracket
              </span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {picked
            ? `Sales held a year or less are taxed at ${picked.ordinaryRatePct}%, longer ones at ${picked.ltcgRatePct}%.`
            : "Not sure? Skip it and we'll assume the 24% bracket (15% on long-term gains)."}
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="state-rate">State income tax, if any (%)</Label>
        <Input
          id="state-rate"
          inputMode="decimal"
          placeholder="0"
          value={stateRate}
          onChange={(e) => setStateRate(e.target.value)}
          className="w-28"
        />
        {!stateOk && <p className="text-xs text-destructive">Enter a rate between 0 and 20.</p>}
      </div>
      {save.error && <p className="text-sm text-destructive">Couldn&apos;t save: {save.error.message}</p>}
      <Button onClick={onContinue} disabled={save.isPending || !stateOk}>
        {save.isPending ? "Saving…" : "Continue"}
      </Button>
    </AuthShell>
  );
}

function AccountsStep({ onDone }: { onDone: () => void }) {
  const trpc = useTRPC();
  const existing = useQuery(trpc.accounts.list.queryOptions({}));
  const create = useMutation(trpc.accounts.create.mutationOptions());
  const have = new Set((existing.data ?? []).map((a) => a.name.toLowerCase()));
  // Brokerage is preselected only for someone with no accounts at all.
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const selected =
    picked ?? (existing.data && existing.data.length === 0 ? new Set(["Brokerage"]) : new Set<string>());
  const [error, setError] = useState<string | null>(null);

  function toggle(name: string) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setPicked(next);
  }

  async function onContinue() {
    setError(null);
    try {
      // One at a time: the first create also makes the "Main" portfolio.
      for (const p of ACCOUNT_PRESETS) {
        if (selected.has(p.name) && !have.has(p.name.toLowerCase()))
          await create.mutateAsync({ name: p.name, accountType: p.type });
      }
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <AuthShell
      tagline="Step 2 of 3 · Accounts"
      title="Where do you invest?"
      subtitle="Tap each kind you have. Tax moves come from taxable accounts; retirement accounts are checked so a rebuy there doesn't cancel a loss."
      footer={<StepFooter onSkip={onDone} />}
    >
      {existing.data && existing.data.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Already set up:{" "}
          {existing.data.map((a) => `${a.name} (${TYPE_LABEL[a.accountType]})`).join(", ")}
        </p>
      )}
      <div role="group" aria-label="Account kinds" className="grid gap-1.5">
        {ACCOUNT_PRESETS.filter((p) => !have.has(p.name.toLowerCase())).map((p) => {
          const on = selected.has(p.name);
          return (
            <button
              key={p.name}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(p.name)}
              className={`${choice(on)} flex items-center gap-2`}
            >
              <span
                className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                  on ? "border-primary bg-primary text-primary-foreground" : ""
                }`}
                aria-hidden
              >
                {on && <Check className="size-3" />}
              </span>
              <span className="font-medium">{p.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">{p.hint}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Rename or retype them any time on the Accounts page.
      </p>
      {error && <p className="text-sm text-destructive">Couldn&apos;t save: {error}</p>}
      <Button onClick={() => void onContinue()} disabled={create.isPending || existing.isLoading}>
        {create.isPending ? "Saving…" : "Continue"}
      </Button>
    </AuthShell>
  );
}

function FirstHoldingStep() {
  const router = useRouter();
  const options = [
    {
      href: "/transactions?add=1",
      Icon: PenLine,
      title: "Type in a holding",
      body: "A ticker, how many and what you paid. Today's price fills in.",
    },
    {
      href: "/transactions?import=1",
      Icon: FileUp,
      title: "Import from your broker",
      body: "Robinhood, Coinbase, Delta or any CSV export.",
    },
  ];
  return (
    <AuthShell
      tagline="Step 3 of 3 · Your first holding"
      title="Add what you own"
      subtitle="One holding is enough to start; the dashboard fills in as you add more."
      footer={
        <StepFooter label="Skip, show me the app" onSkip={() => router.push("/dashboard")} />
      }
    >
      <div className="grid gap-1.5">
        {options.map(({ href, Icon, title, body }) => (
          <Link key={href} href={href} className={`${choice(false)} flex items-start gap-3 py-3`}>
            <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span className="grid gap-0.5">
              <span className="font-medium">{title}</span>
              <span className="text-xs text-muted-foreground">{body}</span>
            </span>
            <ArrowRight className="mt-0.5 ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        ))}
      </div>
    </AuthShell>
  );
}
