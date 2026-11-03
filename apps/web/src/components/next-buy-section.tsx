"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useTargetMix } from "@/components/allocation-section";
import { AssetLogo } from "@/components/asset-logo";
import { Section } from "@/components/page-section";
import { usePortfolio } from "@/components/portfolio-context";
import {
  AssetPicker,
  useDebounced,
  type PickedAsset,
} from "@/components/transactions/asset-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabLoading } from "@/components/tax-center/tab-state";
import { defaultNextBuyAmount, type DepositFrom } from "@/lib/next-buy-defaults";
import { useTRPC } from "@/lib/trpc";
import { useStoredState } from "@/lib/use-stored-state";
import { fmtUsd } from "@/lib/viz";

const MAX_OPTIONS = 5;
const RANK = ["best", "second best", "third best", "fourth best", "fifth best"];
const pctText = (x: number) => `${Number((Math.abs(x) * 100).toFixed(1))}%`;

/**
 * "I have $n — where should it go?" (R-004). The user names an amount and
 * one to five options; core `pickNextBuy` (via `portfolio.nextBuy`) names
 * one with one reason and the account it belongs in, and "Show me another"
 * walks down the ranking. Starts from the three largest holdings and the
 * amount typed here last time (else the usual deposit), so it answers before
 * anything is typed.
 */
export function NextBuySection({
  holdings,
  deposit,
}: {
  /** Largest first, like the overview. */
  holdings: PickedAsset[];
  /** undefined while the history is still loading (null = no deposit in it). */
  deposit: { usd: number; from: DepositFrom } | null | undefined;
}) {
  const trpc = useTRPC();
  const { portfolioId, userId } = usePortfolio();
  const targets = useTargetMix();
  const [typedNow, setTypedNow] = useState<string | null>(null);
  // The amount typed here before, kept per portfolio on this device: the history
  // can't know a habit it hasn't seen (luna's $150 a month, after setup's $450
  // of starting holdings, mission 140), so what she types is what it asks next time.
  const [remembered, setRemembered] = useStoredState<number | null>(
    `beobeo.next-buy.amount.${userId}.${portfolioId ?? "all"}`,
    null,
  );
  const amount = typedNow ?? (remembered !== null && remembered > 0 ? String(remembered) : null);
  const setAmount = (value: string) => {
    setTypedNow(value);
    const usd = Number(value);
    if (usd > 0) setRemembered(usd);
  };
  const [picked, setPicked] = useState<PickedAsset[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState({ key: "", index: 0 });
  const [howOpen, setHowOpen] = useState(false);

  const options = picked ?? holdings.slice(0, 3);
  const defaultAmount = defaultNextBuyAmount(deposit?.usd ?? null);
  // Until the history says what the usual deposit is, the box stays empty
  // rather than showing $500 and then changing under the reader.
  const waiting = amount === null && deposit === undefined;
  const amountStr = amount ?? (waiting ? "" : String(defaultAmount));
  const amountUsd = Math.max(0, Number(amountStr) || 0);
  // Only typing is debounced: the default (or remembered amount) goes out at once.
  const typed = useDebounced(typedNow, 300);
  const debouncedAmount =
    typedNow === null
      ? amountUsd
      : Math.max(0, Number(typed ?? (remembered !== null && remembered > 0 ? remembered : defaultAmount)) || 0);
  const assetIds = options.map((o) => o.id);

  const query = useQuery({
    ...trpc.portfolio.nextBuy.queryOptions({
      portfolioId: portfolioId ?? undefined,
      amountUsd: debouncedAmount || 1,
      assetIds,
      targets,
    }),
    // The default amount waits for the history, so it's asked once, not $500 first.
    enabled: !waiting && debouncedAmount > 0 && assetIds.length > 0,
    placeholderData: keepPreviousData,
  });

  // "Show me another" resets whenever the question changes.
  const inputKey = `${debouncedAmount}|${assetIds.join(",")}`;
  const index = shown.key === inputKey ? shown.index : 0;
  const picks = query.data?.picks ?? [];
  const pick = picks.length > 0 ? picks[index % picks.length]! : null;
  const next = picks.length > 1 ? picks[(index + 1) % picks.length]! : null;
  const ready = options.length > 0 && (waiting || amountUsd > 0);
  // The pick on screen is for an older amount or list until the new one lands.
  const stale = amountUsd !== debouncedAmount || query.isPlaceholderData;

  const remove = (id: string) => setPicked(options.filter((o) => o.id !== id));

  return (
    <Section title="Where should my next buy go?">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="next-buy-amount">I have</label>
        <span className="relative">
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground">
            $
          </span>
          <Input
            id="next-buy-amount"
            type="number"
            inputMode="decimal"
            min={0}
            value={amountStr}
            onChange={(e) => setAmount(e.target.value)}
            className="data h-8 w-28 pl-6"
          />
        </span>
        <span>for one of</span>
        {options.map((o) => (
          <span
            key={o.id}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border pr-1 pl-2.5"
          >
            <AssetLogo symbol={o.symbol} assetClass={o.class} size={16} />
            <span className="font-medium">{o.symbol}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 rounded-full"
              aria-label={`Remove ${o.symbol} from the options`}
              onClick={() => remove(o.id)}
            >
              <X aria-hidden className="size-3.5" />
            </Button>
          </span>
        ))}
        {adding ? (
          <div className="flex w-64 items-center gap-1">
            <AssetPicker
              value={null}
              onChange={(a) => {
                if (!options.some((o) => o.id === a.id)) setPicked([...options, a]);
                setAdding(false);
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Cancel adding an option"
              onClick={() => setAdding(false)}
            >
              <X aria-hidden className="size-4" />
            </Button>
          </div>
        ) : (
          options.length < MAX_OPTIONS && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-muted-foreground"
              onClick={() => setAdding(true)}
            >
              <Plus className="mr-1 size-3.5" /> Add an option
            </Button>
          )
        )}
      </div>
      {/* An unexplained starting amount read as a wrong guess (luna, missions
          64/66/67), so it says where it came from until the user types. */}
      {typedNow === null && !waiting && (
        <p className="-mt-1 text-xs text-muted-foreground">
          {amount !== null
            ? `${fmtUsd(amountUsd)} is the amount you typed here last time. Type another to change it.`
            : deposit
              ? deposit.from === "start"
                ? `${fmtUsd(deposit.usd)} is what your holdings cost when you added them, and nothing's been put in since. Type what you usually put in; it's kept for next time.`
                : `$${defaultAmount.toLocaleString("en-US")} is ${deposit.from === "usual" ? "what you usually put in" : "your last deposit"}. Type the amount you have.`
              : "Type the amount you have."}
        </p>
      )}

      {!ready ? (
        <p className="text-sm text-muted-foreground">
          Enter an amount and one to five things you&apos;re thinking of buying, and
          Beobeo picks one.
        </p>
      ) : !pick || stale ? (
        // An older amount's pick under the new amount read as the answer, and the
        // real one then "flipped" it (luna, missions 84/85: VOO for $150, NVDA for $100).
        pick && stale ? (
          <TabLoading label={`Weighing ${fmtUsd(amountUsd)}…`} className="h-16 max-w-md" />
        ) : query.isError ? (
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t weigh these options right now. Try again in a moment.
          </p>
        ) : (
          <TabLoading label="Weighing your options…" className="h-16 max-w-md" />
        )
      ) : (
        <div className="grid gap-1.5" aria-live="polite">
          <p className="flex flex-wrap items-center gap-x-1.5 text-lg">
            {/* "Put $100 into VOO" on the runner-up read as the recommendation
                (luna, mission 67), so a lower pick says it's the other way. */}
            {index % picks.length === 0 ? "Put" : "Or, next best: put"}{" "}
            <span className="data font-semibold">{fmtUsd(amountUsd)}</span> into
            <AssetLogo symbol={pick.key} assetClass={pick.assetClass} size={20} />
            <span className="font-semibold">{pick.key}</span>
            {/* Says the rank in words: luna couldn't tell which pick came first
                (mission 66), then read "choice 2 of 3" as the pick (mission 86). */}
            {picks.length > 1 && (
              <span className="text-sm text-muted-foreground">
                ({RANK[index % picks.length] ?? `number ${(index % picks.length) + 1}`} of your{" "}
                {picks.length} options)
              </span>
            )}
          </p>
          <p className="text-sm">{pick.reason}</p>
          {/* One buy is the ask (R-004), but next to Allocation's split it read as the
              two sections disagreeing (minerva, mission 49): say which one lands exactly. */}
          {pick.target !== null && pick.target > 0 && pick.weightAfter > pick.target + 0.0005 && (
            <p className="text-sm text-muted-foreground">
              One buy this size goes past its target. To land exactly on your mix, split it
              the way Allocation shows above.
            </p>
          )}
          {pick.account && <p className="text-sm text-muted-foreground">{accountLine(pick.account)}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {/* Named, so two options don't read as a loop with the first pick
                out of sight (luna, mission 84: "Back to the first pick" hid which it was). */}
            {next && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-full"
                onClick={() => setShown({ key: inputKey, index: index + 1 })}
              >
                {(index + 1) % picks.length === 0
                  ? `Back to the first pick, ${next.key}`
                  : `Show me another: ${next.key}`}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-muted-foreground"
              aria-expanded={howOpen}
              aria-controls="next-buy-how"
              onClick={() => setHowOpen((o) => !o)}
            >
              {howOpen ? "Hide how this was picked" : "How this was picked"}
            </Button>
          </div>
          {/* In place, not a popover: one laid over the pick kept closing and hid what
              it explained (luna, mission 64). It stays open through "Show me another". */}
          {howOpen && (
            <HowPicked
              id="next-buy-how"
              pick={pick}
              first={picks[0]!}
              runnerUp={picks[1] ?? null}
              amountUsd={debouncedAmount}
              portfolioValue={query.data?.portfolioValue ?? 0}
            />
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        An analysis of the options you entered, not investment advice. Nothing is bought here.
      </p>
    </Section>
  );
}

const ACCOUNT_KIND = {
  taxable: "taxable account",
  traditional_ira: "Traditional IRA",
  roth_ira: "Roth IRA",
  "401k": "401(k)",
  other_tax_advantaged: "tax-advantaged account",
} as const;

/** "Buy it in Robinhood, your taxable account." The kind is said unless the
 *  name already says it ("Roth IRA"): luna couldn't tell from "Buy it in
 *  Robinhood" which kind of account that was (mission 64). */
function accountLine(account: {
  name: string;
  type: keyof typeof ACCOUNT_KIND;
  why: string | null;
}): string {
  const kind = ACCOUNT_KIND[account.type];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const named = norm(account.name).includes(norm(kind.replace(" account", "")));
  if (!account.why) return `Buy it in ${account.name}${named ? "" : `, your ${kind}`}.`;
  const where = named ? account.name : `${account.name} (your ${kind})`;
  return account.why.startsWith("where")
    ? `Buy it in ${where}, ${account.why}.`
    : `Buy it in ${where}: ${account.why}.`;
}

interface PickFacts {
  key: string;
  fit: number;
  weightNow: number;
  weightAfter: number;
  target: number | null;
  gapUsd: number | null;
  offHigh: number | null;
  vsCost: number | null;
}

/** The pick's numbers in the user's own dollars, then the rule in plain words. */
function HowPicked({
  id,
  pick,
  first,
  runnerUp,
  amountUsd,
  portfolioValue,
}: {
  id: string;
  pick: PickFacts;
  first: PickFacts;
  runnerUp: PickFacts | null;
  amountUsd: number;
  portfolioValue: number;
}) {
  // "Mostly: not putting too much in one place" under a pick that does just that
  // read as the explainer contradicting the pick (luna, mission 84): when price
  // outweighed spread, say so for this pick.
  const priceDecided =
    first.target === null && runnerUp !== null && runnerUp.fit > first.fit;
  const decided = !priceDecided
    ? null
    : pick.key === first.key
      ? `This time price decided it: ${first.key} has dropped more than ${runnerUp.key}.`
      : pick.fit > first.fit
        ? `This time price decided it: ${first.key} has dropped more than ${pick.key}.`
        : null;
  // Three short lines, each led by what it's about: a paragraph of dollars, then a
  // paragraph on the rule, read as "a wall of text… I'm not reading all that"
  // (luna, missions 84–86). The exact dollars stay for anyone checking.
  const held = pick.weightNow * portfolioValue;
  const money =
    pick.target !== null && pick.gapUsd !== null
      ? pick.target > 0
        ? pick.gapUsd <= 0
          ? `Already at its ${pctText(pick.target)} target.`
          : `${fmtUsd(pick.gapUsd)} short of its ${pctText(pick.target)} target${
              pick.weightAfter > pick.target + 0.0005 ? ", so this buy takes it past" : ""
            }.`
        : "Not in your target mix."
      : portfolioValue > 0
        ? `After this ${fmtUsd(amountUsd)}, ${pick.key} would be ${fmtUsd(held + amountUsd)} of your ${fmtUsd(portfolioValue + amountUsd)}, or ${pctText(pick.weightAfter)}.`
        : `${pick.key} would be ${pctText(pick.weightAfter)} of your money after this buy.`;
  const price =
    (pick.offHigh === null
      ? "No past year of prices yet"
      : pick.offHigh > -0.005
        ? "At its highest of the past year"
        : `${pctText(pick.offHigh)} below its high of the past year`) +
    (pick.vsCost === null
      ? "."
      : ` and ${pctText(pick.vsCost)} ${pick.vsCost < 0 ? "below" : "above"} what you paid.`);
  // Mirrors NEXT_BUY_WEIGHTS / NEXT_BUY_TARGET_WEIGHTS and SINGLE_NAME_WEIGHT in
  // @beobeo/core. Plain words: "60/40 score", "counts double", "lopsided" and
  // "concentration" read as homework (luna, missions 64, 84–86).
  const rule =
    pick.target !== null
      ? "Being furthest short of your target counts most (90%). A lower price only settles close calls."
      : "Keeping your money spread out counts most (60%), and one company or coin is less spread out than a fund of many. A lower price counts for the rest (40%).";
  const rows: [string, string][] = [
    ["Your money", money],
    ["Price", price],
    ["The rule", rule],
  ];

  return (
    <div id={id} className="mt-1 grid max-w-xl gap-1.5 border-l-2 border-accent pl-3 text-sm">
      <dl className="grid gap-1 sm:grid-cols-[auto_1fr] sm:gap-x-3">
        {rows.map(([label, text]) => (
          <div key={label} className="contents">
            <dt className="font-medium">{label}</dt>
            <dd className={label === "The rule" ? "text-muted-foreground" : undefined}>{text}</dd>
          </div>
        ))}
      </dl>
      {decided && <p>{decided}</p>}
    </div>
  );
}
