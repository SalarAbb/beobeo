"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { fmtQty, fmtUsd } from "@/lib/viz";
import { cn } from "@/lib/utils";

/** One of the user's own trades behind the comparison (the server's `trades`). */
export interface ReplayTrade {
  date: string;
  type: string | null;
  symbol: string | null;
  amount: number;
}

export interface ReplayBenchmark {
  assetId: string;
  symbol: string;
  color: string;
  fills: { trade: number; fillDate: string; price: number; units: number; unitsAfter: number }[];
  units: number;
  /** Today's price when there's a live quote, else the last close. */
  lastPrice: { date: string; price: number; live: boolean } | null;
  value: number | null;
}

const priceWhen = (p: { date: string; live: boolean }) =>
  p.live ? "today's price" : `the ${fmtShort(p.date)} close`;

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

const fmtShort = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** Units to 4 places (crypto benchmarks need more below one unit). */
const fmtUnits = (v: number) =>
  Math.abs(v) < 1 ? fmtQty(Number(v.toFixed(6))) : v.toLocaleString("en-US", { maximumFractionDigits: 4 });

function tradeLabel(t: ReplayTrade): string {
  const what = t.symbol ?? "";
  switch (t.type) {
    case "buy":
      return `Bought ${what}`;
    case "sell":
      return `Sold ${what}`;
    case "transfer_in":
      return `Moved in ${what}`;
    case "transfer_out":
      return `Moved out ${what}`;
    case "fee":
      return "Fee";
    default:
      return t.amount >= 0 ? `Put in ${what}` : `Took out ${what}`;
  }
}

/**
 * How the comparison was built, so it can be checked: what went in and came
 * out, why that differs from what you paid for what you hold, what each
 * benchmark holds now, and (closed) every trade replayed into it. Arya
 * (mission 111, compare.custom) couldn't tie "put in, minus sales $29,810" to
 * her $30,406 cost and found "no dates, no start or end price, nothing to
 * check against a quote".
 */
export function ReplayTrades({
  trades,
  benchmarks,
  netInvested,
  heldCost,
  realized,
  newestId,
}: {
  trades: ReplayTrade[];
  benchmarks: ReplayBenchmark[];
  /** The benchmark added last; the list opens on it. */
  newestId?: string;
  netInvested: number;
  /** What you paid for what you hold (whole portfolio only). */
  heldCost: number | null;
  /** All-time gain from sales (whole portfolio only). */
  realized: number | null;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  // Opens on the newest benchmark, the one just added (arya, mission 118,
  // picked QQQ and the list opened on SPY). Named by the page, not taken as
  // the payload's last: the comparison is cached by sorted ids, so a cached
  // payload can list SPY after QQQ.
  const bench =
    benchmarks.find((b) => b.assetId === picked) ??
    benchmarks.find((b) => b.assetId === newestId) ??
    benchmarks.at(-1);
  if (!bench || trades.length === 0) return null;

  const bought = trades.reduce((s, t) => s + Math.max(t.amount, 0), 0);
  const sold = trades.reduce((s, t) => s - Math.min(t.amount, 0), 0);
  // The gap to what you paid is your gain from sales only when that's what
  // it adds up to (a transfer in at no price would break the tie).
  const gap = heldCost === null ? null : heldCost - netInvested;
  const gapIsSales =
    gap !== null && realized !== null && Math.abs(gap) >= 1 && Math.abs(gap - realized) < 1;
  const fillsByTrade = new Map(bench.fills.map((f) => [f.trade, f]));

  return (
    <div className="grid gap-4 text-sm">
      <div className="grid max-w-3xl gap-2 leading-relaxed">
        <p>
          {sold >= 0.005 ? (
            <>
              You put in <span className="data">{fmtUsd(bought)}</span> (buys and their fees) and
              your sales brought back <span className="data">{fmtUsd(sold)}</span>, so{" "}
              <span className="data">{fmtUsd(netInvested)}</span> went in, minus sales: the dashed
              line on the chart.
            </>
          ) : (
            <>
              You put in <span className="data">{fmtUsd(bought)}</span> (buys and their fees), the
              dashed line on the chart.
            </>
          )}{" "}
          {gapIsSales && heldCost !== null && gap !== null && (
            <>
              That&apos;s <span className="data">{fmtUsd(Math.abs(gap))}</span>{" "}
              {gap > 0 ? "less" : "more"} than the <span className="data">{fmtUsd(heldCost)}</span>{" "}
              you paid for what you hold now, because your sales brought back{" "}
              <span className="data">{fmtUsd(Math.abs(gap))}</span> {gap > 0 ? "more" : "less"}{" "}
              than those shares cost (your gain from sales).
            </>
          )}
        </p>
        <p className="text-muted-foreground">
          Each benchmark got the same dollars on the same days: a buy bought it at that day&apos;s
          close (the next trading day&apos;s when markets were closed), a sale sold it. Prices are
          adjusted for later splits.
        </p>
        <ul className="grid gap-0.5">
          {benchmarks.map((b) => (
            <li key={b.assetId}>
              <span
                aria-hidden
                className="mr-1.5 inline-block size-2 rounded-full"
                style={{ background: b.color }}
              />
              <span className="font-medium">{b.symbol}</span>{" "}
              {b.lastPrice ? (
                <span className="data">
                  holds {fmtUnits(b.units)} now × {fmtUsd(b.lastPrice.price)} (
                  {priceWhen(b.lastPrice)}) = {fmtUsd(b.value)}
                </span>
              ) : (
                <span className="text-muted-foreground">has no prices yet</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <details className="group">
        <summary className="w-fit cursor-pointer text-primary marker:text-muted-foreground">
          Show the <span className="data">{trades.length}</span>{" "}
          {trades.length === 1 ? "trade" : "trades"} replayed into{" "}
          {benchmarks.length === 1 ? bench.symbol : "each benchmark"}
        </summary>
        <div className="mt-3 grid gap-3">
          {benchmarks.length > 1 && (
            <SegmentedControl
              value={bench.assetId}
              onChange={setPicked}
              options={benchmarks.map((b) => ({ value: b.assetId, label: b.symbol }))}
            />
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="eyebrow py-2 pr-3 font-normal">Date</th>
                  <th className="eyebrow px-3 py-2 font-normal">You</th>
                  <th className="eyebrow px-3 py-2 text-right font-normal">
                    {bench.symbol} close
                  </th>
                  <th className="eyebrow px-3 py-2 text-right font-normal">
                    {bench.symbol} units
                  </th>
                  <th className="eyebrow hidden py-2 pl-3 text-right font-normal sm:table-cell">
                    Held after
                  </th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => {
                  const f = fillsByTrade.get(i);
                  return (
                    <tr key={i} className="border-b last:border-0">
                      <td className="data whitespace-nowrap py-1.5 pr-3">{fmtDate(t.date)}</td>
                      <td className="px-3 py-1.5">
                        <span className="whitespace-nowrap">{tradeLabel(t)}</span>{" "}
                        <span className="data block text-muted-foreground sm:inline">
                          {fmtUsd(Math.abs(t.amount))}
                        </span>
                      </td>
                      <td className="data whitespace-nowrap px-3 py-1.5 text-right">
                        {f ? (
                          <>
                            {fmtUsd(f.price)}
                            {f.fillDate !== t.date && (
                              <span className="block text-xs text-muted-foreground">
                                {fmtShort(f.fillDate)} close
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">no price</span>
                        )}
                      </td>
                      <td
                        className={cn(
                          "data whitespace-nowrap px-3 py-1.5 text-right",
                          f && f.units < 0 && "text-muted-foreground",
                        )}
                      >
                        {f ? `${f.units >= 0 ? "+" : "−"}${fmtUnits(Math.abs(f.units))}` : "—"}
                      </td>
                      <td className="data hidden whitespace-nowrap py-1.5 pl-3 text-right sm:table-cell">
                        {f ? fmtUnits(f.unitsAfter) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t font-medium">
                  <td className="py-2 pr-3">Together</td>
                  <td className="px-3 py-2">
                    <span className="data">{fmtUsd(netInvested)}</span>{" "}
                    <span className="block font-normal text-muted-foreground sm:inline">
                      went in, minus sales
                    </span>
                  </td>
                  <td className="data whitespace-nowrap px-3 py-2 text-right">
                    {bench.lastPrice && (
                      <>
                        {fmtUsd(bench.lastPrice.price)}
                        <span className="block text-xs font-normal text-muted-foreground">
                          {bench.lastPrice.live ? "today" : `${fmtShort(bench.lastPrice.date)} close`}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="data whitespace-nowrap px-3 py-2 text-right">
                    {fmtUnits(bench.units)}
                    <span className="block text-xs font-normal text-muted-foreground">
                      worth {fmtUsd(bench.value)}
                    </span>
                  </td>
                  <td className="data hidden whitespace-nowrap py-2 pl-3 text-right sm:table-cell">
                    {fmtUnits(bench.units)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </details>
    </div>
  );
}
