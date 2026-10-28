"use client";

import { Section } from "@/components/page-section";
import { SellPlanChart } from "@/components/tax-center/sell-plan-chart";
import { fmtUsd, gainClass } from "@/lib/viz";
import { cn } from "@/lib/utils";

interface Lot {
  symbol: string;
  assetClass: string;
  accountName: string;
  assetId: string;
  lotId: string;
  openedAt: string;
}
interface Sale {
  lot: Lot;
  sellQuantity: number;
  proceeds: number;
  realizedGain: number;
  isLongTerm: boolean;
  taxCost: number;
  netAfterTax: number;
  ripening: { daysUntilLongTerm: number; estSavingsIfWaited: number } | null;
}
interface Block {
  symbol: string;
  disallowedLossUsd: number;
  permanentlyDisallowed: boolean;
  triggerAccountName: string;
  triggerDate: string;
  likelyDividendReinvestment: boolean;
}

/** First day a loss sale no longer falls inside the 30-day window after the
 *  triggering buy (UTC date key, like every other date on this page). */
const clearsOn = (triggerIso: string) =>
  new Date(Date.parse(triggerIso) + 31 * 86_400_000).toISOString().slice(0, 10);

/** One row per symbol + triggering buy: the engine blocks each lot, but a
 *  user thinks "my VXUS is on hold because of the Oct 5 buy", not nine rows. */
function groupBlocks(blocked: Block[]) {
  const groups = new Map<string, Block & { key: string; lots: number }>();
  for (const b of blocked) {
    const key = `${b.symbol}|${b.triggerAccountName}|${b.triggerDate}|${b.permanentlyDisallowed}`;
    const g = groups.get(key);
    if (g) {
      g.lots += 1;
      g.disallowedLossUsd += b.disallowedLossUsd;
    } else {
      groups.set(key, { ...b, key, lots: 1 });
    }
  }
  return [...groups.values()];
}
const fmtUnits = (q: number) => q.toLocaleString("en-US", { maximumFractionDigits: 6 });

/**
 * The plan's purchases one by one, closed by default: what you tell your broker
 * when you sell specific shares instead of its oldest-first default (petyr, mission
 * 4: "the plan only gave per-ticker totals, so I never saw which lots to sell").
 * Same order as the chart's columns.
 */
function PurchaseList({ sales }: { sales: Sale[] }) {
  const order = [...new Set(sales.map((s) => s.lot.symbol))];
  // The optimizer's swap pass can leave a zero-unit sale behind: nothing to tell a broker.
  const rows = sales
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.sellQuantity > 0)
    .sort((a, b) => order.indexOf(a.s.lot.symbol) - order.indexOf(b.s.lot.symbol) || a.i - b.i)
    .map(({ s }) => s);
  return (
    <details className="group text-sm">
      <summary className="w-fit cursor-pointer text-primary marker:text-muted-foreground">
        Show the{" "}
        {rows.length === 1 ? (
          "purchase"
        ) : (
          <>
            <span className="data">{rows.length}</span> purchases
          </>
        )}{" "}
        to sell
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Tell your broker to sell these specific shares (often called &quot;specific lot&quot;),
        or it sells your oldest shares first.
      </p>
      <ul className="mt-2 grid divide-y border-y">
        {rows.map((s) => (
          <li
            key={s.lot.lotId}
            className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-0.5 py-2"
          >
            <span>
              <span className="font-medium">{s.lot.symbol}</span>{" "}
              <span className="text-muted-foreground">
                bought <span className="data">{s.lot.openedAt.slice(0, 10)}</span>
              </span>
            </span>
            <span className={cn("data text-right", gainClass(s.realizedGain))}>
              {fmtUsd(s.realizedGain)}
            </span>
            <span className="data text-xs text-muted-foreground">
              Sell {fmtUnits(s.sellQuantity)} in {s.lot.accountName} · {fmtUsd(s.proceeds)}
            </span>
            <span className="text-right text-xs text-muted-foreground">
              {s.isLongTerm ? "long-term" : "short-term"}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

interface Excluded {
  lot: Lot;
  reason: string;
}

/**
 * Shared plan renderer — used by both Raise Cash and Harvest Losses.
 *
 * Deliberately NOT a wall of per-lot columns: the two things that matter are
 * *what to sell, in what order* (the chart's x-axis, real sell order) and
 * *the cumulative effect as you go* (the chart's y-axis, running realized
 * gain/loss). Per-lot dollar detail — proceeds, tax cost, net after tax —
 * lives in the chart's hover tooltip, available on demand rather than
 * printed by default for every row.
 */
export function PlanView({
  sales,
  blocked,
  shortfall,
  totalProceeds,
  excluded,
  startingRealizedGain,
}: {
  sales: Sale[];
  blocked: Block[];
  shortfall?: number;
  totalProceeds: number;
  excluded?: Excluded[];
  /** Realized capital gains so far this year — the waterfall's starting point. */
  startingRealizedGain?: number;
}) {
  return (
    <div className="grid gap-10">
      {shortfall !== undefined && shortfall > 0.5 && (
        <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm">
          Everything you can sell adds up to{" "}
          <span className="data">{fmtUsd(totalProceeds)}</span>, which is{" "}
          <span className="data">{fmtUsd(shortfall)}</span> short of your target.
        </p>
      )}

      {sales.length > 0 && (
        <Section title="What to sell, in order">
          <SellPlanChart
            sales={sales}
            startingRealizedGain={startingRealizedGain}
            cashRaised={totalProceeds}
          />
          <PurchaseList sales={sales} />
          {excluded && excluded.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Left alone (your do-not-sell list):{" "}
              {[...new Set(excluded.map((e) => e.lot.symbol))].join(", ")}
            </p>
          )}
        </Section>
      )}

      {blocked.length > 0 && (
        <Section title="On hold">
          <p className="-mt-2 text-sm text-muted-foreground">
            You bought the same asset within the last 30 days, so selling these at a loss
            wouldn&apos;t count this year (the wash-sale rule). Wait until 30 days after that
            buy.
          </p>
          <ul className="grid divide-y border-y">
            {groupBlocks(blocked).map((b) => (
              <li key={b.key} className="grid gap-0.5 py-2.5 text-sm">
                {/* the note gets its own line: beside the symbol it squeezed into a
                    three-line column on a phone */}
                <div className="flex items-baseline gap-3">
                  <span className="font-medium">{b.symbol}</span>
                  {b.lots > 1 && (
                    <span className="text-xs whitespace-nowrap text-muted-foreground">
                      <span className="data">{b.lots}</span> purchases
                    </span>
                  )}
                  <span className="data ml-auto text-loss">{fmtUsd(-b.disallowedLossUsd)}</span>
                </div>
                <p
                  className={cn(
                    "text-xs",
                    b.permanentlyDisallowed ? "text-loss" : "text-muted-foreground",
                  )}
                >
                  {b.permanentlyDisallowed
                    ? "Sell now and the loss is gone for good (retirement-account buy)."
                    : "Sell now and the loss is only postponed."}
                </p>
                <p className="text-xs text-muted-foreground">
                  Bought again in {b.triggerAccountName} on{" "}
                  <span className="data">{b.triggerDate.slice(0, 10)}</span>
                  {b.likelyDividendReinvestment && " (looks like a dividend reinvestment)"}
                  {" "}
                  · safe to sell from <span className="data">{clearsOn(b.triggerDate)}</span>
                </p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            A different fund tracking the same index? The IRS hasn&apos;t said whether that
            counts as the same asset, so we can&apos;t promise it&apos;s safe.
          </p>
        </Section>
      )}

      {sales.length === 0 && blocked.length === 0 && (
        <p className="border-y py-10 text-center text-sm text-muted-foreground">
          Nothing to sell here right now.
        </p>
      )}
    </div>
  );
}
