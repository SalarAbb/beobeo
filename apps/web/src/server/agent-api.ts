import { and, desc, eq, ilike } from "drizzle-orm";
import { db, schema } from "@beobeo/db";
import { buildLots, D, realizedByYear, toIsoDate } from "@beobeo/core";
import type { PortfolioApi } from "@beobeo/agent";
import { getMarketData } from "./market-data";
import {
  computeDcaComparison,
  computeOverview,
  computePosition,
  loadEngineTransactions,
} from "./portfolio";

/** Resolve a symbol to an asset the user actually holds/held. */
async function findUserAsset(userId: string, symbol: string) {
  const rows = await db
    .selectDistinct({ asset: schema.assets })
    .from(schema.transactions)
    .innerJoin(schema.assets, eq(schema.transactions.assetId, schema.assets.id))
    .where(
      and(
        eq(schema.transactions.userId, userId),
        ilike(schema.assets.symbol, symbol),
      ),
    );
  return rows[0]?.asset ?? null;
}

/** Read-only PortfolioApi bound to one authenticated user. */
export function makePortfolioApi(userId: string, portfolioId?: string): PortfolioApi {
  return {
    async getPortfolioSummary() {
      return computeOverview(userId, portfolioId);
    },

    async getPositionDetails(symbol) {
      const asset = await findUserAsset(userId, symbol);
      if (!asset) return { error: `No position found for ${symbol}` };
      const position = await computePosition(userId, asset.id, portfolioId);
      if (!position) return { error: `No position found for ${symbol}` };
      // Trim the price series — the agent doesn't need 900 rows of tape.
      return { ...position, priceSeries: position.priceSeries.slice(-30) };
    },

    async getTransactions({ symbol, limit = 50 }) {
      const conditions = [eq(schema.transactions.userId, userId)];
      if (symbol) {
        const asset = await findUserAsset(userId, symbol);
        if (!asset) return { error: `No transactions found for ${symbol}` };
        conditions.push(eq(schema.transactions.assetId, asset.id));
      }
      const rows = await db
        .select({
          symbol: schema.assets.symbol,
          type: schema.transactions.type,
          quantity: schema.transactions.quantity,
          pricePerUnit: schema.transactions.pricePerUnit,
          fees: schema.transactions.fees,
          tradedAt: schema.transactions.tradedAt,
          note: schema.transactions.note,
        })
        .from(schema.transactions)
        .innerJoin(schema.assets, eq(schema.transactions.assetId, schema.assets.id))
        .where(and(...conditions))
        .orderBy(desc(schema.transactions.tradedAt))
        .limit(limit);
      return rows.map((r) => ({ ...r, tradedAt: toIsoDate(r.tradedAt) }));
    },

    async getRealizedGains(year) {
      const { txns, assets } = await loadEngineTransactions(db, userId, undefined, undefined, portfolioId);
      const perAsset = new Map<string, typeof txns>();
      for (const t of txns) {
        const g = perAsset.get(t.assetId);
        if (g) g.push(t);
        else perAsset.set(t.assetId, [t]);
      }
      const allRealized = [...perAsset.entries()].flatMap(([assetId, assetTxns]) =>
        buildLots(assetTxns).realized.map((g) => ({
          ...g,
          symbol: assets.get(assetId)!.symbol,
        })),
      );
      const years = realizedByYear(allRealized)
        .filter((y) => year === undefined || y.year === year)
        .map((y) => ({
          year: y.year,
          shortTerm: y.shortTerm.toNumber(),
          longTerm: y.longTerm.toNumber(),
          total: y.total.toNumber(),
          sales: y.entries.map((g) => ({
            symbol: (g as { symbol?: string }).symbol,
            soldAt: toIsoDate(g.soldAt),
            acquiredAt: toIsoDate(g.acquiredAt),
            quantity: g.quantity.toNumber(),
            gain: g.gain.toNumber(),
            longTerm: g.longTerm,
          })),
        }));
      return years;
    },

    async runDcaComparison(benchmarkSymbol) {
      const rows = await db
        .select()
        .from(schema.assets)
        .where(ilike(schema.assets.symbol, benchmarkSymbol));
      const asset = rows[0];
      if (!asset) {
        return {
          error: `Unknown benchmark ${benchmarkSymbol}. Available: SPY, VOO, QQQ, BTC, or any asset in the user's portfolio.`,
        };
      }
      const result = await computeDcaComparison(userId, {
        benchmarkIds: [asset.id],
        portfolioId,
      });
      // Curves are for charts; the agent needs the endpoints and returns.
      const bench = result.benchmarks[0];
      const lastP = result.portfolio[result.portfolio.length - 1];
      const lastB = bench?.series[bench.series.length - 1];
      return {
        benchmark: bench?.symbol ?? asset.symbol,
        portfolioFinalValue: lastP?.value ?? null,
        benchmarkFinalValue: lastB?.value ?? null,
        totalInvested: lastP?.invested ?? null,
        portfolioAnnualReturn: result.portfolioXirr,
        benchmarkAnnualReturn: bench?.xirr ?? null,
        difference:
          lastP && lastB ? D(lastP.value).sub(lastB.value).toNumber() : null,
      };
    },

    async getPriceHistory(symbol, days) {
      const asset = await findUserAsset(userId, symbol);
      if (!asset) return { error: `No asset found for ${symbol}` };
      const to = toIsoDate(new Date());
      const from = toIsoDate(new Date(Date.now() - days * 86_400_000));
      const prices = await getMarketData().getPrices(asset, from, to);
      return [...prices.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, close]) => ({ date, close: close.toNumber() }));
    },
  };
}
