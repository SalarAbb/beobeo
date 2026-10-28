"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AssetLogo } from "@/components/asset-logo";
import { METRIC_LABEL_CLASS, MetricHover } from "@/components/metric-hover";
import { Section, StatStrip, StatTile } from "@/components/page-section";
import { usePortfolio } from "@/components/portfolio-context";
import { PriceChart } from "@/components/charts/price-chart";
import { RealizedBars } from "@/components/charts/realized-bars";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TabError, TabLoading } from "@/components/tax-center/tab-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTRPC } from "@/lib/trpc";
import { fmtPct, fmtQty, fmtUsd, gainClass } from "@/lib/viz";

type LotsView = "lots" | "sales";

const NUM = "text-right data text-[13px]";

/** What kind of thing this is, in plain words: luna couldn't find out what an
 *  ETF is anywhere in the app (theme `explain-terms-plain-language`). */
const KINDS: Record<string, { label: string; insight: string; meaning: string }> = {
  stock: {
    label: "Stock",
    insight: "A small piece of one company.",
    meaning: "Its price moves with that one company, so it swings more than a fund holding hundreds.",
  },
  etf: {
    label: "ETF",
    insight: "A basket of many investments you buy as one.",
    meaning:
      "An exchange-traded fund holds many stocks or bonds at once, so one share spreads your money across all of them. It trades during the day like a stock.",
  },
  fund: {
    label: "Mutual fund",
    insight: "A basket of many investments, priced once a day.",
    meaning:
      "It pools many people's money into stocks or bonds. Orders fill at the day's closing price, not during the day.",
  },
  crypto: {
    label: "Crypto",
    insight: "A digital currency that trades around the clock.",
    meaning:
      "Prices swing much more than stocks. The IRS treats it as property, so selling it is taxed like selling a stock.",
  },
  cash: {
    label: "Cash",
    insight: "Money waiting to be invested.",
    meaning: "It doesn't rise or fall with the market.",
  },
};

/** A tile label that opens a short explanation on hover or tap (R-002). */
function Explained({
  label,
  term,
  insight,
  meaning,
}: {
  label: string;
  term: string;
  insight: string;
  meaning: string;
}) {
  return (
    // `uppercase`: a button resets the eyebrow's text-transform.
    <MetricHover label={label} term={term} insight={insight} meaning={meaning} className="uppercase">
      <span className={METRIC_LABEL_CLASS}>{label}</span>
    </MetricHover>
  );
}

export default function PositionPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { portfolioId } = usePortfolio();
  const [view, setView] = useState<LotsView>("lots");
  const position = useQuery(
    trpc.portfolio.position.queryOptions({
      assetId,
      portfolioId: portfolioId ?? undefined,
    }),
  );

  if (position.isLoading) {
    // The dashboard already knows the symbol; show it at once instead of grey boxes, which a
    // persona caught mid-load and reported as a blank page (barristan, mission 31).
    const known = queryClient
      .getQueriesData<{ holdings: { assetId: string; symbol: string; class: string; name: string }[] }>({
        queryKey: trpc.portfolio.overview.pathKey(),
      })
      .flatMap(([, d]) => d?.holdings ?? [])
      .find((h) => h.assetId === assetId);
    return (
      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-8">
        {known && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <AssetLogo symbol={known.symbol} assetClass={known.class} size={36} />
            <h1 className="text-3xl">{known.symbol}</h1>
            {known.name !== known.symbol && (
              <span className="min-w-0 truncate text-sm text-muted-foreground">{known.name}</span>
            )}
          </div>
        )}
        <TabLoading
          label={`Loading ${known?.symbol ?? "this position"}: your purchases, sales and price history…`}
          className="h-40 px-4 text-center"
        />
      </div>
    );
  }

  const data = position.data;
  if (!data && position.isError) {
    return (
      <div className="mx-auto max-w-5xl">
        <TabError what="this position" onRetry={() => void position.refetch()} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-5xl">
        <p className="text-sm text-muted-foreground">
          Position not found.{" "}
          <Link href="/dashboard" className="underline">
            Back to dashboard
          </Link>
        </p>
      </div>
    );
  }

  const { asset, position: pos } = data;
  const realized = data.realizedYears.reduce((s, y) => s + y.total, 0);
  const sales = data.realizedEntries.length;
  const kind = KINDS[asset.class];
  const units = `${fmtQty(pos.quantity)} ${pos.quantity === 1 ? "unit" : "units"}`;

  return (
    <TooltipProvider delayDuration={150}>
    <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-12">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <AssetLogo symbol={asset.symbol} assetClass={asset.class} size={36} />
        <h1 className="text-3xl">{asset.symbol}</h1>
        <span className="min-w-0 truncate text-sm text-muted-foreground">{asset.name}</span>
        {kind ? (
          <MetricHover
            label={kind.label}
            insight={kind.insight}
            meaning={kind.meaning}
            className="eyebrow ml-auto"
          >
            <span className={METRIC_LABEL_CLASS}>{kind.label}</span>
          </MetricHover>
        ) : (
          <span className="eyebrow ml-auto">{asset.class}</span>
        )}
      </div>

      <StatStrip className="-mt-6">
        <StatTile
          label="Value"
          value={fmtUsd(pos.marketValue)}
          sub={`${fmtQty(pos.quantity)} × ${fmtUsd(pos.price)}`}
        />
        <StatTile
          label={
            <Explained
              label="Gain on holdings"
              term="Unrealized gain"
              insight={
                pos.unrealizedGain === null
                  ? "No price yet, so no gain to show."
                  : `${pos.unrealizedGain < 0 ? "Down" : "Up"} ${fmtUsd(Math.abs(pos.unrealizedGain))} on the ${units} you still hold.`
              }
              meaning="What you'd make or lose selling them at today's price. It stays on paper until you sell, and no tax is due before then."
            />
          }
          value={fmtUsd(pos.unrealizedGain)}
          sub={fmtPct(pos.unrealizedGainPct)}
          tone={gainClass(pos.unrealizedGain)}
        />
        <StatTile
          label={
            <Explained
              label="What you paid"
              term="Cost basis"
              insight={`${fmtUsd(pos.costBasis)} for the ${units} you hold, ${fmtUsd(pos.avgCost)} each on average.`}
              meaning="Fees included. When you sell, your taxable gain is the sale price minus this."
            />
          }
          value={fmtUsd(pos.costBasis)}
          sub={`${fmtUsd(pos.avgCost)} each on average`}
        />
        <StatTile
          label={
            <Explained
              label="Gain from sales"
              term="Realized gain"
              insight={
                sales === 0
                  ? "You haven't sold any yet."
                  : `${realized < 0 ? "Lost" : "Made"} ${fmtUsd(Math.abs(realized))} across ${sales} ${sales === 1 ? "sale" : "sales"}, all years.`
              }
              meaning="Profit or loss you locked in by selling. Each year's part is taxed in that year; the chart below splits it by year."
            />
          }
          value={fmtUsd(realized)}
          sub={pos.dividends > 0 ? `+ ${fmtUsd(pos.dividends)} dividends` : undefined}
          tone={gainClass(realized)}
        />
      </StatStrip>

      <Section title="Price & your trades">
        <PriceChart
          prices={data.priceSeries}
          markers={data.markers}
          costBasisSteps={data.costBasisSteps}
        />
      </Section>

      <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-10">
        <Section title="Gain from sales by year">
          <RealizedBars data={data.realizedYears} />
        </Section>

        <Section
          title={view === "lots" ? "Purchases you still hold" : "Sales"}
          aside={
            <SegmentedControl
              value={view}
              onChange={setView}
              options={[
                { value: "lots", label: `Held (${data.lots.length})` },
                { value: "sales", label: `Sales (${data.realizedEntries.length})` },
              ]}
            />
          }
        >
          {view === "lots" ? (
            data.lots.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">You don&apos;t hold any right now</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-1">Bought</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Price paid</TableHead>
                    <TableHead className="pr-1 text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.lots.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-1 data text-[13px]">
                        {l.openedAt}
                      </TableCell>
                      <TableCell className={NUM}>{fmtQty(l.quantity)}</TableCell>
                      <TableCell className={NUM}>{fmtUsd(l.avgCost)}</TableCell>
                      <TableCell className={`pr-1 ${NUM}`}>{fmtUsd(l.costBasis)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          ) : data.realizedEntries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing sold yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-1">Sold</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Gain</TableHead>
                  <TableHead className="pr-1 text-right">Owned</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.realizedEntries.map((g, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-1 data text-[13px]">
                      {g.soldAt}
                    </TableCell>
                    <TableCell className={NUM}>{fmtQty(g.quantity)}</TableCell>
                    <TableCell className={`${NUM} ${gainClass(g.gain)}`}>
                      {fmtUsd(g.gain)}
                    </TableCell>
                    <TableCell className="pr-1 text-right text-xs text-muted-foreground">
                      {g.longTerm ? "Over a year" : "Under a year"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      </div>
    </div>
    </TooltipProvider>
  );
}
