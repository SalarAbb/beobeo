"use client";

import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileUp, PenLine, ArrowRight, Loader2 } from "lucide-react";
import {
  bracketOptions,
  ratesAtIncome,
  STANDARD_DEDUCTION,
  taxableFromPay,
  type BracketOption,
  type FilingStatus,
} from "@beobeo/core/tax-brackets";
import { AuthShell } from "@/components/auth/auth-shell";
import { AddTransactionDialog } from "@/components/transactions/add-transaction-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useIncome } from "@/components/tax-center/use-income";
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

/** What step 1 writes to the tax profile (nothing when skipped). */
type TaxAnswers = {
  federalOrdinaryRatePct?: number;
  federalLtcgRatePct?: number;
  stateOrdinaryRatePct?: number;
  stateLtcgRatePct?: number;
  stateTreatsLtcgAsOrdinary?: boolean;
};

type AccountPreset = (typeof ACCOUNT_PRESETS)[number];

export function WelcomeFlow({ name }: { name: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const first = name.trim().split(/\s+/)[0] ?? "";
  // Each step's answers save in the background while the next step shows: a
  // Continue stuck on "Saving…" read as a broken sign-up (hermione, missions
  // 18 and 21). Step 1's failure is reported on step 2; step 3 waits for the
  // accounts before its add form can use them.
  const saveTax = useMutation(trpc.tax.updateProfile.mutationOptions());
  // Step 2 needs the account list; fetch it while step 1 is being read.
  useQuery(trpc.accounts.list.queryOptions({}));
  const createAccount = useMutation(trpc.accounts.create.mutationOptions());
  const [accounts, setAccounts] = useState<{ saving: boolean; error: string | null }>({
    saving: false,
    error: null,
  });

  async function createAccounts(presets: AccountPreset[]) {
    setStep(3);
    if (presets.length === 0) return;
    setAccounts({ saving: true, error: null });
    try {
      // One at a time: the first create also makes the "Main" portfolio.
      for (const p of presets) await createAccount.mutateAsync({ name: p.name, accountType: p.type });
      // The add form lists accounts; a stale empty list would make it create "Default".
      await queryClient.invalidateQueries({ queryKey: trpc.accounts.list.queryKey() });
      setAccounts({ saving: false, error: null });
    } catch (e) {
      setAccounts({ saving: false, error: (e as Error).message });
    }
  }

  if (step === 1)
    return (
      <TaxStep
        first={first}
        onDone={(answers) => {
          if (answers) saveTax.mutate(answers);
          setStep(2);
        }}
      />
    );
  if (step === 2)
    return (
      <AccountsStep
        taxError={saveTax.error?.message ?? null}
        onDone={(presets) => void createAccounts(presets)}
      />
    );
  return <FirstHoldingStep accountsSaving={accounts.saving} accountsError={accounts.error} />;
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

function TaxStep({
  first,
  onDone,
}: {
  first: string;
  onDone: (answers: TaxAnswers | null) => void;
}) {
  const [status, setStatus] = useState<FilingStatus>("single");
  const [band, setBand] = useState<number | null>(null);
  // Optional pay before deductions. People know their pay, not their taxable
  // income: hermione ($250k, married) expected 32% and read the 24% band
  // setup chose as wrong. Typing it picks the band and says why.
  const [payText, setPayText] = useState("");
  const [stateRate, setStateRate] = useState("");
  const bands = bracketOptions(status);
  const payNum = Number(payText.replace(/[$,\s]/g, ""));
  const pay = payText.trim() !== "" && Number.isFinite(payNum) && payNum >= 0 ? payNum : null;
  const taxable = pay === null ? null : taxableFromPay(status, pay);
  const fromPay = taxable === null ? null : ratesAtIncome(status, taxable);
  // A tapped band wins over the typed pay.
  const chosen = band ?? fromPay?.band ?? null;
  const picked = chosen === null ? null : bands[chosen];
  const usesPay = fromPay !== null && chosen === fromPay.band;
  const rates = usesPay ? fromPay : picked;
  const statePct = Number(stateRate);
  const stateOk = stateRate.trim() === "" || (Number.isFinite(statePct) && statePct >= 0 && statePct <= 20);
  // Filing status and income have no server column yet; the device keeps
  // them for Tax Profile → Your income (the 0% gain room, R-003).
  const { income, setIncome } = useIncome();

  function onContinue() {
    if (picked) setIncome({ status, taxableIncomeUsd: usesPay ? taxable : income.taxableIncomeUsd });
    if (!rates && stateRate.trim() === "") return onDone(null);
    onDone({
      ...(rates && {
        federalOrdinaryRatePct: rates.ordinaryRatePct,
        federalLtcgRatePct: rates.ltcgRatePct,
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
      footer={<StepFooter onSkip={() => onDone(null)} />}
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
        <Label htmlFor="pay">Your pay this year, roughly</Label>
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-muted-foreground">$</span>
          <Input
            id="pay"
            inputMode="decimal"
            placeholder={status === "married_joint" ? "e.g. 150000 for both of you" : "e.g. 85000"}
            value={payText}
            onChange={(e) => {
              setPayText(e.target.value);
              setBand(null);
            }}
            className="data w-48"
          />
        </div>
        {taxable !== null && fromPay && (
          <p className="text-xs text-muted-foreground">
            After the <span className="data">${STANDARD_DEDUCTION[status].toLocaleString("en-US")}</span>{" "}
            standard deduction, that&apos;s about{" "}
            <span className="data">${Math.round(taxable).toLocaleString("en-US")}</span> of taxable
            income: the {bands[fromPay.band]!.ordinaryRatePct}% bracket below.
          </p>
        )}
      </div>
      <div className="grid gap-2">
        <Label id="band-label">Or pick your taxable income</Label>
        <p className="-mt-1 text-xs text-muted-foreground">
          2026 federal brackets. Taxable income is what&apos;s left after deductions, so it&apos;s
          usually well below your pay.
        </p>
        <div role="radiogroup" aria-labelledby="band-label" className="grid gap-1.5">
          {bands.map((b, i) => (
            <button
              key={b.ordinaryRatePct}
              type="button"
              role="radio"
              aria-checked={chosen === i}
              onClick={() => {
                if (chosen !== i) return setBand(i);
                // Un-picking the band the pay chose forgets the pay too.
                setBand(null);
                setPayText("");
              }}
              className={`${choice(chosen === i)} flex items-center justify-between gap-3`}
            >
              <span className="data font-medium">{bandLabel(b)}</span>
              <span className="data text-xs text-muted-foreground">
                {b.ordinaryRatePct}% bracket
              </span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {rates
            ? `Sales held a year or less are taxed at ${rates.ordinaryRatePct}%, longer ones at ${rates.ltcgRatePct}%.`
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
      <Button onClick={onContinue} disabled={!stateOk}>
        Continue
      </Button>
    </AuthShell>
  );
}

function AccountsStep({
  onDone,
  taxError,
}: {
  onDone: (presets: AccountPreset[]) => void;
  taxError: string | null;
}) {
  const trpc = useTRPC();
  const existing = useQuery(trpc.accounts.list.queryOptions({}));
  const have = new Set((existing.data ?? []).map((a) => a.name.toLowerCase()));
  // An account already set up under another name ("IBKR", "401k") covers the
  // preset of its type: offering it again, unticked, read as "will this make a
  // duplicate?" (hermione, missions 18 and 21). The crypto exchange is only
  // covered by name, since a brokerage doesn't stand in for it.
  const haveTypes = new Set<string>((existing.data ?? []).map((a) => a.accountType));
  const offered = ACCOUNT_PRESETS.filter(
    (p) =>
      !have.has(p.name.toLowerCase()) && !(p.name !== "Crypto exchange" && haveTypes.has(p.type)),
  );
  // Brokerage is preselected only for someone with no accounts at all.
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const selected =
    picked ?? (existing.data && existing.data.length === 0 ? new Set(["Brokerage"]) : new Set<string>());

  function toggle(name: string) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setPicked(next);
  }

  return (
    <AuthShell
      tagline="Step 2 of 3 · Accounts"
      title="Where do you invest?"
      subtitle="Tap each kind you have. Tax moves come from taxable accounts; retirement accounts are checked so a rebuy there doesn't cancel a loss."
      footer={<StepFooter onSkip={() => onDone([])} />}
    >
      {taxError && (
        <p className="text-sm text-destructive">
          Your tax answers didn&apos;t save ({taxError}). Set them any time in Tax Center → Tax
          Profile.
        </p>
      )}
      {existing.data && existing.data.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Already set up:{" "}
          {existing.data.map((a) => `${a.name} (${TYPE_LABEL[a.accountType]})`).join(", ")}.
          {offered.length > 0 && " Tap any others you have; nothing is added twice."}
        </p>
      )}
      {/* Nothing until the list is known: rendering every kind and then
          dropping the covered ones moved the rows under a click (mission 22). */}
      {existing.isLoading && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Checking your accounts…
        </p>
      )}
      <div role="group" aria-label="Account kinds" className="grid gap-1.5">
        {existing.data && offered.map((p) => {
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
      <Button
        onClick={() => onDone(offered.filter((p) => selected.has(p.name)))}
        disabled={existing.isLoading}
      >
        Continue
      </Button>
    </AuthShell>
  );
}

/** The arrow turns into "Opening…" while the next page loads: a click that
 *  showed nothing for seconds got clicked again as if it were dead. */
function LinkProgress() {
  const { pending } = useLinkStatus();
  return pending ? (
    <span className="mt-0.5 ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" aria-hidden /> Opening…
    </span>
  ) : (
    <ArrowRight className="mt-0.5 ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
  );
}

function OptionText({ title, body }: { title: string; body: string }) {
  return (
    <span className="grid gap-0.5">
      <span className="font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">{body}</span>
    </span>
  );
}

function FirstHoldingStep({
  accountsSaving,
  accountsError,
}: {
  accountsSaving: boolean;
  accountsError: string | null;
}) {
  const router = useRouter();
  const card = `${choice(false)} flex w-full items-start gap-3 py-3 disabled:pointer-events-none disabled:opacity-60`;
  return (
    <AuthShell
      tagline="Step 3 of 3 · Your first holding"
      title="Add what you own"
      subtitle="One holding is enough to start; the dashboard fills in as you add more."
      footer={
        <StepFooter label="Skip, show me the app" onSkip={() => router.push("/dashboard")} />
      }
    >
      {accountsSaving && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Adding your accounts…
        </p>
      )}
      {accountsError && (
        <p className="text-sm text-destructive">
          Your accounts didn&apos;t save ({accountsError}). Add them any time on the Accounts
          page.
        </p>
      )}
      <div className="grid gap-1.5">
        {/* The form opens right here (it used to send you to /transactions,
            which read as being dropped out of setup), then lands on the dashboard. */}
        <AddTransactionDialog
          onCreated={() => router.push("/dashboard")}
          trigger={
            <button type="button" className={card} disabled={accountsSaving}>
              <PenLine className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <OptionText
                title="Type in a holding"
                body="A ticker, how many and what you paid. Today's price fills in."
              />
              <ArrowRight className="mt-0.5 ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          }
        />
        <Link
          href="/transactions?import=1"
          aria-disabled={accountsSaving}
          className={`${card} ${accountsSaving ? "pointer-events-none opacity-60" : ""}`}
        >
          <FileUp className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <OptionText
            title="Import from your broker"
            body="Robinhood, Coinbase, Delta or any CSV export."
          />
          <LinkProgress />
        </Link>
      </div>
    </AuthShell>
  );
}
