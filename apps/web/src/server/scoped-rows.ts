import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@beobeo/db";
import { sharedRun, userCacheKey } from "./cache";

export interface ScopedTxnRow {
  txn: typeof schema.transactions.$inferSelect;
  asset: typeof schema.assets.$inferSelect;
  account: typeof schema.accounts.$inferSelect;
}

/**
 * Every transaction in a scope ("all" or a portfolio id) with its asset and
 * account, oldest first. One query, shared: the Tax Center's lots and the
 * dashboard's engine load (`loadEngineTransactions`, which `tax.now` reaches
 * through `computeOverview`) read the same rows, and a cold `tax.now` used to
 * send that query twice to the serializing Neon driver. A finished load
 * lingers a few seconds so a page batch arriving right after its layout's
 * warm-up joins it; every write drops it (`invalidateUserComputations`).
 * The rows are read-only to callers.
 */
export function loadScopedRows(userId: string, portfolioKey: string): Promise<ScopedTxnRow[]> {
  return sharedRun(
    userCacheKey(userId, "scoped-rows", portfolioKey),
    async () => {
      const conditions = [eq(schema.transactions.userId, userId)];
      if (portfolioKey !== "all") {
        conditions.push(eq(schema.accounts.portfolioId, portfolioKey));
      }
      return db
        .select({ txn: schema.transactions, asset: schema.assets, account: schema.accounts })
        .from(schema.transactions)
        .innerJoin(schema.assets, eq(schema.transactions.assetId, schema.assets.id))
        .innerJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
        .where(and(...conditions))
        .orderBy(asc(schema.transactions.tradedAt), asc(schema.transactions.createdAt));
    },
    { lingerMs: 5_000 },
  );
}
