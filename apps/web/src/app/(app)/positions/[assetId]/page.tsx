"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AssetLogo } from "@/components/asset-logo";
import { Section, StatStrip, StatTile } from "@/components/page-section";
import { usePortfolio } from "@/components/portfolio-context";
import { PriceChart } from "@/components/charts/price-chart";
import { RealizedBars } from "@/components/charts/realized-bars";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
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

export default function PositionPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const trpc = useTRPC();
  const { portfolioId } = usePortfolio();
  const [view, setView] = useState<LotsView>("lots");
  const position = useQuery(
    trpc.portfolio.position.queryOptions({
      assetId,
      portfolioId: portfolioId ?? undefined,
    }),
  );

  if (position.isLoading) {
    return (
      <div className="mx-auto grid max-w-5xl gap-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const data = position.data;
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

  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-12">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <AssetLogo symbol={asset.symbol} assetClass={asset.class} size={36} />
        <h1 className="text-3xl">{asset.symbol}</h1>
        <span className="min-w-0 truncate text-sm text-muted-foreground">{asset.name}</span>
        <span className="eyebrow ml-auto">{asset.class}</span>
      </div>

      <StatStrip className="-mt-6">
        <StatTile
          label="Market value"
          value={fmtUsd(pos.marketValue)}
          sub={`${fmtQty(pos.quantity)} × ${fmtUsd(pos.price)}`}
        />
        <StatTile
          label="Unrealized P/L"
          value={fmtUsd(pos.unrealizedGain)}
          sub={fmtPct(pos.unrealizedGainPct)}
          tone={gainClass(pos.unrealizedGain)}
        />
        <StatTile
          label="Cost basis"
          value={fmtUsd(pos.costBasis)}
          sub={`avg ${fmtUsd(pos.avgCost)}`}
        />
        <StatTile
          label="Realized P/L"
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
        <Section title="Realized gains by year">
          <RealizedBars data={data.realizedYears} />
        </Section>

        <Section
          title={view === "lots" ? "Open lots" : "Sales"}
          aside={
            <SegmentedControl
              value={view}
              onChange={setView}
              options={[
                { value: "lots", label: `Open lots (${data.lots.length})` },
                { value: "sales", label: `Sales (${data.realizedEntries.length})` },
              ]}
            />
          }
        >
          {view === "lots" ? (
            data.lots.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No open lots</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-1">Acquired</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Avg cost</TableHead>
                    <TableHead className="pr-1 text-right">Basis</TableHead>
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
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Gain</TableHead>
                  <TableHead className="pr-1 text-right">Term</TableHead>
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
                      {g.longTerm ? "Long" : "Short"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      </div>
    </div>
  );
}
