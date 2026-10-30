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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TabLoading } from "@/components/tax-center/tab-state";
import { defaultNextBuyAmount } from "@/lib/next-buy-defaults";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { fmtUsd } from "@/lib/viz";

const MAX_OPTIONS = 5;
const pctText = (x: number) => `${Number((Math.abs(x) * 100).toFixed(1))}%`;

/**
 * "I have $n — where should it go?" (R-004). The user names an amount and
 * one to five options; core `pickNextBuy` (via `portfolio.nextBuy`) names
 * one with one reason and the account it belongs in, and "Show me another"
 * walks down the ranking. Starts from the three largest holdings and the
 * last deposit, so it answers before anything is typed.
 */
export function NextBuySection({
  holdings,
  lastDeposit,
}: {
  /** Largest first, like the overview. */
  holdings: PickedAsset[];
  /** undefined while the history is still loading (null = no deposit in it). */
  lastDeposit: number | null | undefined;
}) {
  const trpc = useTRPC();
  const { portfolioId } = usePortfolio();
  const targets = useTargetMix();
  const [amount, setAmount] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedAsset[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState({ key: "", index: 0 });

  const options = picked ?? holdings.slice(0, 3);
  const defaultAmount = defaultNextBuyAmount(lastDeposit ?? null);
  // Until the history says what the last deposit was, the box stays empty
  // rather than showing $500 and then changing under the reader.
  const waiting = amount === null && lastDeposit === undefined;
  const amountStr = amount ?? (waiting ? "" : String(defaultAmount));
  const amountUsd = Math.max(0, Number(amountStr) || 0);
  // Only typing is debounced: the default goes out at once, and exactly as the
  // dashboard layout warmed it.
  const typed = useDebounced(amount, 300);
  const debouncedAmount =
    amount === null ? amountUsd : Math.max(0, Number(typed ?? defaultAmount) || 0);
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

      {!ready ? (
        <p className="text-sm text-muted-foreground">
          Enter an amount and one to five things you&apos;re thinking of buying, and
          Beobeo picks one.
        </p>
      ) : !pick ? (
        query.isError ? (
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t weigh these options right now. Try again in a moment.
          </p>
        ) : (
          <TabLoading label="Weighing your options…" className="h-16 max-w-md" />
        )
      ) : (
        <div
          className={cn("grid gap-1.5 transition-opacity", stale && "opacity-50")}
          aria-live="polite"
          aria-busy={stale}
        >
          {stale && (
            <p className="text-xs text-muted-foreground">Weighing {fmtUsd(amountUsd)}…</p>
          )}
          <p className="flex flex-wrap items-center gap-x-1.5 text-lg">
            {/* The typed amount, never the one still being weighed: "$150" under a
                freshly typed $100 read as the box ignoring it (luna, mission 29). */}
            Put <span className="data font-semibold">{fmtUsd(amountUsd)}</span> into
            <AssetLogo symbol={pick.key} assetClass={pick.assetClass} size={20} />
            <span className="font-semibold">{pick.key}</span>
            {picks.length > 1 && index % picks.length > 0 && (
              <span className="text-sm text-muted-foreground">
                (choice {(index % picks.length) + 1} of {picks.length})
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
          {pick.account && (
            <p className="text-sm text-muted-foreground">
              Buy it in {pick.account.name}
              {pick.account.why
                ? pick.account.why.startsWith("where")
                  ? `, ${pick.account.why}.`
                  : `: ${pick.account.why}.`
                : "."}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {picks.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-full"
                onClick={() => setShown({ key: inputKey, index: index + 1 })}
              >
                {(index + 1) % picks.length === 0 ? "Back to the first pick" : "Show me another"}
              </Button>
            )}
            <HowPicked pick={pick} />
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        An analysis of the options you entered, not investment advice.
      </p>
    </Section>
  );
}

function HowPicked({
  pick,
}: {
  pick: {
    key: string;
    weightNow: number;
    weightAfter: number;
    target: number | null;
    gapUsd: number | null;
    offHigh: number | null;
    vsCost: number | null;
  };
}) {
  const lines: string[] = [
    `${pick.key} is ${pctText(pick.weightNow)} of this portfolio now, ${pctText(pick.weightAfter)} after this buy.`,
  ];
  if (pick.target !== null && pick.gapUsd !== null)
    lines.push(
      pick.target > 0
        ? `Your target for it is ${pctText(pick.target)}: ${
            pick.gapUsd <= 0
              ? "already reached"
              : pick.weightAfter > pick.target + 0.0005
                ? `${fmtUsd(pick.gapUsd)} short, so all of this buy carries it past the target`
                : `${fmtUsd(pick.gapUsd)} short`
          }.`
        : "It has no share in your target mix.",
    );
  lines.push(
    pick.offHigh === null
      ? "No price history yet to compare against its 1-year range."
      : pick.offHigh > -0.005
        ? "It trades at its 1-year high."
        : `It trades ${pctText(pick.offHigh)} below its 1-year high.`,
  );
  if (pick.vsCost !== null)
    lines.push(
      `That's ${pctText(pick.vsCost)} ${pick.vsCost < 0 ? "under" : "over"} what you paid on average.`,
    );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 text-muted-foreground">
          How this was picked
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-80 gap-2 text-sm">
        <ul className="grid gap-1">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        {/* Mirrors NEXT_BUY_WEIGHTS / NEXT_BUY_TARGET_WEIGHTS in @beobeo/core. */}
        <p className="border-t pt-2 text-xs text-muted-foreground">
          {pick.target !== null
            ? "With a target mix, the option furthest short of its target comes first (90% of the score). How far it sits below its 1-year high and your cost only settles close calls (10%)."
            : "Each option is scored 60% on how spread out your money would be and 40% on how far it sits below its 1-year high and your cost. A single company or coin counts twice as much here: it can fall on its own in a way a fund holding many companies rarely does."}
        </p>
      </PopoverContent>
    </Popover>
  );
}
