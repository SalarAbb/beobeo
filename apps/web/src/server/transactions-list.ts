import { and, count, desc, eq } from "drizzle-orm";
import { db, schema } from "@beobeo/db";
import { sharedRun, userCacheKey } from "./cache";

/**
 * The Transactions page's three reads, shared by the routers and the page's
 * layout warm-up. Concurrent callers with the same input share one run
 * (`sharedRun`, dropped by `invalidateUserComputations` on any write), so the
 * page's first batch joins the queries its layout started during the HTML
 * request instead of queueing four cold ones on the serializing Neon driver.
 * Results are read-only to callers. A finished read lingers a few seconds
 * (every write drops it at once), since the warm-up usually finishes before
 * the page's batch arrives; the rows carry Dates, so `cached` (JSON) can't hold them.
 */
const LINGER = { lingerMs: 5_000 };

export function loadTransactionList(
  userId: string,
  input: { assetId?: string; accountId?: string; portfolioId?: string; limit: number },
) {
  const key = userCacheKey(
    userId,
    "txn-list",
    input.portfolioId ?? "all",
    input.assetId ?? "-",
    input.accountId ?? "-",
    String(input.limit),
  );
  return sharedRun(key, async () => {
    const conditions = [eq(schema.transactions.userId, userId)];
    if (input.assetId) conditions.push(eq(schema.transactions.assetId, input.assetId));
    if (input.accountId) conditions.push(eq(schema.transactions.accountId, input.accountId));
    if (input.portfolioId) conditions.push(eq(schema.accounts.portfolioId, input.portfolioId));
    return db
      .select({
        txn: schema.transactions,
        asset: schema.assets,
        account: schema.accounts,
      })
      .from(schema.transactions)
      .innerJoin(schema.assets, eq(schema.transactions.assetId, schema.assets.id))
      .innerJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
      .where(and(...conditions))
      // Same day: the one entered last first, so a payout typed in for a date
      // that already has one shows on top (olenna, mission 113).
      .orderBy(desc(schema.transactions.tradedAt), desc(schema.transactions.createdAt))
      .limit(input.limit);
  }, LINGER);
}

/** Distinct assets the user has transactions in, with counts (the list's "Show"
 *  filter; the ticker picker matches them as you type, from the first letter). */
export function loadTransactionAssets(userId: string, portfolioId?: string) {
  return sharedRun(userCacheKey(userId, "txn-assets", portfolioId ?? "all"), async () => {
    const conditions = [eq(schema.transactions.userId, userId)];
    if (portfolioId) conditions.push(eq(schema.accounts.portfolioId, portfolioId));
    return db
      .select({
        id: schema.assets.id,
        symbol: schema.assets.symbol,
        name: schema.assets.name,
        class: schema.assets.class,
        count: count(),
      })
      .from(schema.transactions)
      .innerJoin(schema.assets, eq(schema.transactions.assetId, schema.assets.id))
      .innerJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
      .where(and(...conditions))
      .groupBy(schema.assets.id)
      .orderBy(schema.assets.symbol);
  }, LINGER);
}

export function loadAccountList(userId: string, portfolioId?: string) {
  return sharedRun(userCacheKey(userId, "account-list", portfolioId ?? "all"), async () => {
    const conditions = [eq(schema.accounts.userId, userId)];
    if (portfolioId) conditions.push(eq(schema.accounts.portfolioId, portfolioId));
    return db
      .select()
      .from(schema.accounts)
      .where(and(...conditions))
      .orderBy(schema.accounts.createdAt);
  }, LINGER);
}
