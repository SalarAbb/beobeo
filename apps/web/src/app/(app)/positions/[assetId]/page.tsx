"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AssetLogo } from "@/components/asset-logo";
import { usePortfolio } from "@/components/portfolio-context";
import { PriceChart } from "@/components/charts/price-chart";
import { RealizedBars } from "@/components/charts/realized-bars";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTRPC } from "@/lib/trpc";
import { fmtPct, fmtQty, fmtUsd, gainClass } from "@/lib/viz";

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

export default function PositionPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const trpc = useTRPC();
  const { portfolioId } = usePortfolio();
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

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <div className="flex items-center gap-3">
        <AssetLogo symbol={asset.symbol} assetClass={asset.class} size={36} />
        <h1 className="text-2xl font-semibold tracking-tight">{asset.symbol}</h1>
        <span className="text-muted-foreground">{asset.name}</span>
        <Badge variant="outline" className="uppercase">
          {asset.class}
        </Badge>
      </div>

      <Card>
        <CardContent className="grid grid-cols-3 gap-x-6 gap-y-4 py-5 md:grid-cols-6">
          <Stat label="Quantity" value={fmtQty(pos.quantity)} />
          <Stat label="Price" value={fmtUsd(pos.price)} />
          <Stat label="Market value" value={fmtUsd(pos.marketValue)} />
          <Stat label="Avg cost" value={fmtUsd(pos.avgCost)} />
          <Stat label="Cost basis" value={fmtUsd(pos.costBasis)} />
          <Stat
            label="Unrealized P/L"
            value={`${fmtUsd(pos.unrealizedGain)} (${fmtPct(pos.unrealizedGainPct)})`}
            tone={gainClass(pos.unrealizedGain)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Price & your trades</CardTitle>
        </CardHeader>
        <CardContent>
          <PriceChart
            prices={data.priceSeries}
            markers={data.markers}
            costBasisSteps={data.costBasisSteps}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Realized gains by year</CardTitle>
          </CardHeader>
          <CardContent>
            <RealizedBars data={data.realizedYears} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open lots & sales</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="lots">
              <TabsList>
                <TabsTrigger value="lots">
                  Open lots ({data.lots.length})
                </TabsTrigger>
                <TabsTrigger value="sales">
                  Sales ({data.realizedEntries.length})
                </TabsTrigger>
              </TabsList>
              <TabsContent value="lots">
                {data.lots.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No open lots
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Acquired</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Avg cost</TableHead>
                        <TableHead className="text-right">Basis</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.lots.map((l, i) => (
                        <TableRow key={i}>
                          <TableCell className="tabular-nums">{l.openedAt}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtQty(l.quantity)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtUsd(l.avgCost)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtUsd(l.costBasis)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>
              <TabsContent value="sales">
                {data.realizedEntries.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Nothing sold yet
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sold</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Gain</TableHead>
                        <TableHead>Term</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.realizedEntries.map((g, i) => (
                        <TableRow key={i}>
                          <TableCell className="tabular-nums">{g.soldAt}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtQty(g.quantity)}
                          </TableCell>
                          <TableCell
                            className={`text-right tabular-nums ${gainClass(g.gain)}`}
                          >
                            {fmtUsd(g.gain)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={g.longTerm ? "secondary" : "outline"}>
                              {g.longTerm ? "Long" : "Short"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {pos.dividends > 0 && (
        <p className="text-sm text-muted-foreground">
          Dividend income to date:{" "}
          <span className={`font-medium ${gainClass(pos.dividends)}`}>
            {fmtUsd(pos.dividends)}
          </span>
        </p>
      )}
    </div>
  );
}
