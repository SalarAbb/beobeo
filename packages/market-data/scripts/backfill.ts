/**
 * Backfill price_history for every asset that has transactions, from its
 * first transaction date through today — then sync corporate actions
 * (splits) for every cached equity/ETF/fund, since a split inside an
 * already-covered span is never revisited by the gap-based cache.
 *
 * Run: pnpm --filter @beobeo/market-data backfill
 */
import { config } from "dotenv";
config({ path: "../../.env" });

import { min } from "drizzle-orm";
import { toIsoDate, type IsoDate } from "@beobeo/core";

async function main() {
  const { db, schema } = await import("@beobeo/db");
  const { MarketDataService } = await import("../src/service");

  const service = new MarketDataService(db, {
    tiingoApiKey: process.env.TIINGO_API_KEY || undefined,
    alphaVantageApiKey: process.env.ALPHA_VANTAGE_API_KEY || undefined,
    coinGeckoApiKey: process.env.COINGECKO_API_KEY || undefined,
  });

  const firstTxnByAsset = await db
    .select({
      assetId: schema.transactions.assetId,
      first: min(schema.transactions.tradedAt),
    })
    .from(schema.transactions)
    .groupBy(schema.transactions.assetId);

  const assets = await db.select().from(schema.assets);
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const today = toIsoDate(new Date());

  for (const { assetId, first } of firstTxnByAsset) {
    const asset = assetById.get(assetId);
    if (!asset || !first) continue;
    const from = toIsoDate(first);
    process.stdout.write(`${asset.symbol} (${asset.class}) ${from} → ${today} ... `);
    try {
      const prices = await service.getPrices(
        { id: asset.id, symbol: asset.symbol, class: asset.class, providerRef: asset.providerRef },
        from,
        today,
      );
      console.log(`${prices.size} closes cached`);
    } catch (e) {
      console.log(`FAILED: ${(e as Error).message}`);
    }
  }

  // Split sync covers ALL cached non-crypto assets — including benchmark-only
  // assets that have price history but no transactions.
  console.log("\nSyncing corporate actions (splits)...");
  const coverage = await db
    .select({
      assetId: schema.priceHistory.assetId,
      first: min(schema.priceHistory.date),
    })
    .from(schema.priceHistory)
    .groupBy(schema.priceHistory.assetId);

  for (const { assetId, first } of coverage) {
    const asset = assetById.get(assetId);
    if (!asset || !first || asset.class === "crypto" || asset.class === "cash")
      continue;
    process.stdout.write(`${asset.symbol} splits ${first} → ${today} ... `);
    try {
      const n = await service.syncCorporateActions(
        { id: asset.id, symbol: asset.symbol, class: asset.class, providerRef: asset.providerRef },
        first as IsoDate,
        today,
      );
      console.log(n > 0 ? `${n} split(s) recorded` : "none");
    } catch (e) {
      console.log(`FAILED: ${(e as Error).message}`);
    }
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
