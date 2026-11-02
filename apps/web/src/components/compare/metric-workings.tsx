"use client";

import type { ReactNode } from "react";
import { fmtUsd } from "@/lib/viz";

/**
 * Head to head, worked out (R-002: experts can reach every number). A closed
 * disclosure under the table that gives each measure its technical name, the
 * formula in words, and every column's own inputs, so the table can be redone
 * by hand. Hermione (2026-11-02): "'Reward for risk 0.36 vs 0.75': what's the
 * risk-free rate, daily or monthly returns, annualization? I can't tie this to
 * my notebook", and "call these XIRR and TWR and show the exact numbers".
 * The table itself keeps its plain names; this sits one deliberate tap away.
 */

export interface WorkingsColumn {
  key: string;
  label: string;
  color: string;
  xirr: number | null; // fraction
  metrics: {
    spanDays: number;
    from: string | null;
    to: string | null;
    returnDays: number;
    twr: number | null;
    twrAnnualized: number | null;
    volatility: number | null;
    maxDrawdown: number | null;
    maxDrawdownFrom: string | null;
    sharpe: number | null;
    sharpeInputs: {
      meanDaily: number;
      annualReturn: number;
      riskFree: number;
      volatility: number;
      days: number;
    } | null;
  };
  last: { value: number; invested: number } | undefined;
}

const pct = (v: number, digits = 2) => `${v.toFixed(digits)}%`;
const signed = (v: number, digits = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}%`;
const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

function Measure({
  name,
  term,
  how,
  columns,
  line,
}: {
  name: string;
  term: string;
  how: ReactNode;
  columns: WorkingsColumn[];
  line: (c: WorkingsColumn) => ReactNode;
}) {
  return (
    <div className="grid gap-1.5 border-b pb-3 last:border-0 last:pb-0">
      <p className="font-medium">
        {name} <span className="font-normal text-muted-foreground">· {term}</span>
      </p>
      <p className="text-muted-foreground">{how}</p>
      <ul className="grid gap-0.5">
        {columns.map((c) => (
          <li key={c.key} className="flex items-baseline gap-2">
            <span
              aria-hidden
              className="inline-block size-2 shrink-0 translate-y-[-1px] rounded-full"
              style={{ background: c.color }}
            />
            <span className="w-14 shrink-0 truncate">{c.label}</span>
            <span className="data min-w-0">{line(c)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const none = <span className="text-muted-foreground">not enough history yet</span>;

export function MetricWorkings({
  columns,
  tradeCount,
  showYearlyRate,
}: {
  columns: WorkingsColumn[];
  /** Dated buys and sales behind every column (the same flows). */
  tradeCount: number;
  showYearlyRate: boolean;
}) {
  const you = columns[0]?.metrics;
  const riskFree = columns.find((c) => c.metrics.sharpeInputs)?.metrics.sharpeInputs?.riskFree;
  const period =
    you?.from && you.to ? (
      <>
        {" "}
        from <span className="data">{fmtDate(you.from)}</span> to{" "}
        <span className="data">{fmtDate(you.to)}</span>
      </>
    ) : null;
  return (
    <details className="group text-sm">
      <summary className="w-fit cursor-pointer text-primary marker:text-muted-foreground">
        Show how each measure is worked out
      </summary>
      <div className="mt-3 grid max-w-3xl gap-3">
        <p className="text-muted-foreground">
          Every column uses the same daily values{period}: yours from your trades at each
          day&apos;s close, each benchmark&apos;s from the same dollars on the same days. A
          day&apos;s return is that day&apos;s value ÷ (the day before&apos;s value + money put in
          or taken out that day) − 1, so deposits never count as gains. A day where the money
          moved was over a quarter of the value and the result over 25% is dropped as a pricing
          mismatch.
        </p>

        <Measure
          name="Gain on your money"
          term="simple return"
          how="Value now ÷ (put in, minus sales) − 1, at today's prices like the strip above."
          columns={columns}
          line={(c) =>
            c.last && c.last.invested > 0 ? (
              <>
                {fmtUsd(c.last.value)} ÷ {fmtUsd(c.last.invested)} − 1 ={" "}
                {signed((c.last.value / c.last.invested - 1) * 100)}
              </>
            ) : (
              none
            )
          }
        />

        {showYearlyRate && (
          <Measure
            name="Yearly rate"
            term="XIRR, money-weighted return"
            how={
              <>
                The one yearly rate at which your <span className="data">{tradeCount}</span>{" "}
                dated buys and sales, with the value now counted as a final sale, net to zero. It
                weighs each dollar by how long it was in.
              </>
            }
            columns={columns}
            line={(c) => (c.xirr === null ? none : <>{signed(c.xirr * 100)} a year</>)}
          />
        )}

        <Measure
          name="Growth of your picks"
          term="TWR, time-weighted return"
          how={
            <>
              The daily returns chained: (1 + r₁) × (1 + r₂) × … − 1, so when you added money
              doesn&apos;t count. Per year: (1 + TWR)^(365 ÷ days) − 1.
            </>
          }
          columns={columns}
          line={(c) =>
            c.metrics.twr === null ? (
              none
            ) : (
              <>
                {signed(c.metrics.twr)} over {c.metrics.returnDays} daily returns
                {c.metrics.twrAnnualized !== null && (
                  <>
                    {" "}
                    · {signed(c.metrics.twrAnnualized)} a year over{" "}
                    {Math.round(c.metrics.spanDays)} days
                  </>
                )}
              </>
            )
          }
        />

        <Measure
          name="Swings"
          term="annualized volatility"
          how="Standard deviation of the daily returns that moved (unchanged weekends and holidays left out), each day weighted by the money in it that day, × √252 trading days. A column holding crypto counts more days, since crypto also moves on weekends; days after the last close carry it forward and don't count."
          columns={columns}
          line={(c) =>
            c.metrics.volatility === null ? (
              none
            ) : (
              <>
                {pct(c.metrics.volatility)}
                {c.metrics.sharpeInputs && <> from {c.metrics.sharpeInputs.days} days that moved</>}
              </>
            )
          }
        />

        <Measure
          name="Biggest drop"
          term="max drawdown"
          how="The deepest fall of the chained daily returns from a high, counted from the first day the money in reached 10% of its peak, so a sale never counts as a fall and a tiny first position can't define it."
          columns={columns}
          line={(c) =>
            c.metrics.maxDrawdown === null ? (
              none
            ) : (
              <>
                {signed(c.metrics.maxDrawdown)}
                {c.metrics.maxDrawdownFrom && <>, counted from {fmtDate(c.metrics.maxDrawdownFrom)}</>}
              </>
            )
          }
        />

        <Measure
          name="Reward for risk"
          term="Sharpe ratio"
          how={
            <>
              (Yearly return − cash rate) ÷ swings. The yearly return is the money-weighted
              average daily return compounded over 252 trading days, (1 + mean)^252 − 1, from the
              same days as Swings
              {riskFree !== undefined && (
                <>
                  . The cash rate is a fixed <span className="data">{pct(riskFree, 1)}</span>,
                  about what Treasury bills paid
                </>
              )}
              .
            </>
          }
          columns={columns}
          line={(c) => {
            const s = c.metrics.sharpeInputs;
            if (!s || c.metrics.sharpe === null) return none;
            return (
              <>
                (1 + {pct(s.meanDaily, 4)})^252 − 1 = {pct(s.annualReturn)}; ({pct(s.annualReturn)}{" "}
                − {pct(s.riskFree)}) ÷ {pct(s.volatility)} = {c.metrics.sharpe.toFixed(2)}
              </>
            );
          }}
        />
      </div>
    </details>
  );
}
