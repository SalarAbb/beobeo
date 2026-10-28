import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@beobeo/db";
import { pickNextBuy, toIsoDate, type IsoDate, type NextBuyCandidate } from "@beobeo/core";
import { cached, userCacheKey } from "./cache";
import { getMarketData } from "./market-data";
import { computeOverview } from "./portfolio";

const TTL = 60;
const RANGE_DAYS = 365;

/** Bond funds by ticker, for names that don't say "bond". */
const BOND_TICKERS = new Set([
  "BND", "AGG", "BNDX", "TLT", "IEF", "SHY", "VGIT", "VGSH", "VGLT", "BSV", "BIV",
  "BLV", "SCHZ", "GOVT", "TIP", "VTIP", "SGOV", "BIL", "LQD", "HYG", "JNK", "VCIT",
]);

/** Interest-heavy funds belong in a tax-advantaged account. Municipal bonds
 *  pay tax-free interest, so they don't. */
export function isIncomeHeavy(symbol: string, name: string, assetClass: string): boolean {
  if (assetClass === "crypto" || assetClass === "stock") return false;
  if (/\b(municipal|muni|tax[- ]exempt)\b/i.test(name)) return false;
  return (
    BOND_TICKERS.has(symbol.toUpperCase()) ||
    /\b(bonds?|treasur(y|ies)|fixed income|tips)\b/i.test(name)
  );
}

export interface NextBuyInput {
  portfolioId?: string;
  amountUsd: number;
  assetIds: string[];
  /** Target mix as fractions keyed by symbol (saved on the device for now). */
  targets?: Record<string, number> | null;
}

/**
 * "I have $n — where should it go?" (R-004). Core `pickNextBuy` ranks the
 * candidates, best first; the UI's "Show me another" walks the list. Ranking
 * is pure and cheap, so only the gathering is cached: a new amount or target
 * mix answers at once, and the dashboard layout's warm-up serves every
 * device's target mix.
 */
export async function computeNextBuy(userId: string, input: NextBuyInput) {
  const ids = [...new Set(input.assetIds)].sort();
  if (ids.length === 0 || !(input.amountUsd > 0)) return { picks: [] };
  const { portfolioValue, candidates, meta, accounts } = await loadNextBuyCandidates(
    userId,
    input.portfolioId,
    ids,
  );
  const picks = pickNextBuy({
    amountUsd: input.amountUsd,
    portfolioValue,
    candidates,
    targets: input.targets,
    accounts,
  });
  return { picks: picks.map((p) => ({ ...p, ...meta[p.key]! })) };
}

/**
 * What `pickNextBuy` needs for each candidate: what the user holds of it
 * (from the cached overview), its trailing-year range, and which accounts it
 * already sits in. `ids` must be sorted (they're the cache key).
 */
function loadNextBuyCandidates(userId: string, portfolioId: string | undefined, ids: string[]) {
  return cached(
    userCacheKey(userId, "nextbuy-in", portfolioId ?? "all", ids.join(",")),
    TTL,
    () => loadNextBuyCandidatesUncached(userId, portfolioId, ids),
  );
}

async function loadNextBuyCandidatesUncached(
  userId: string,
  portfolioId: string | undefined,
  ids: string[],
) {
  const accountScope = [eq(schema.accounts.userId, userId)];
  if (portfolioId) accountScope.push(eq(schema.accounts.portfolioId, portfolioId));

  const [overview, assetRows, accountRows, buys] = await Promise.all([
    computeOverview(userId, portfolioId),
    db.select().from(schema.assets).where(inArray(schema.assets.id, ids)),
    db
      .select({
        id: schema.accounts.id,
        name: schema.accounts.name,
        type: schema.accounts.accountType,
      })
      .from(schema.accounts)
      .where(and(...accountScope))
      .orderBy(schema.accounts.createdAt),
    db
      .select({ assetId: schema.transactions.assetId, accountId: schema.transactions.accountId })
      .from(schema.transactions)
      .innerJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
      .where(
        and(
          ...accountScope,
          eq(schema.transactions.userId, userId),
          inArray(schema.transactions.assetId, ids),
          inArray(schema.transactions.type, ["buy", "transfer_in"]),
        ),
      )
      .orderBy(desc(schema.transactions.tradedAt)),
  ]);

  const heldIn = new Map<string, string[]>();
  for (const b of buys) {
    const list = heldIn.get(b.assetId) ?? [];
    if (!list.includes(b.accountId)) list.push(b.accountId);
    heldIn.set(b.assetId, list);
  }

  const today = toIsoDate(new Date());
  const from = toIsoDate(new Date(Date.now() - RANGE_DAYS * 86_400_000)) as IsoDate;
  const series = await getMarketData()
    .getPricesBulk(assetRows, from, today)
    .catch(() => new Map<string, Map<IsoDate, unknown>>());

  const holdingBy = new Map(overview.holdings.map((h) => [h.assetId, h]));
  const meta: Record<string, { assetId: string; name: string; assetClass: string; price: number | null }> =
    {};
  const candidates: NextBuyCandidate[] = assetRows.map((a) => {
    const held = holdingBy.get(a.id);
    const closes = [...(series.get(a.id) ?? new Map()).entries()]
      .sort(([d1], [d2]) => (d1 < d2 ? -1 : 1))
      .map(([, c]) => Number(c));
    const price = held?.price ?? closes.at(-1) ?? null;
    const range = price !== null ? [...closes, price] : closes;
    meta[a.symbol] = { assetId: a.id, name: a.name, assetClass: a.class, price };
    return {
      key: a.symbol,
      assetClass: a.class,
      price,
      rangeLow: range.length > 0 ? Math.min(...range) : null,
      rangeHigh: range.length > 0 ? Math.max(...range) : null,
      avgCost: held?.avgCost ?? null,
      heldValue: held?.marketValue ?? 0,
      incomeHeavy: isIncomeHeavy(a.symbol, a.name, a.class),
      heldIn: heldIn.get(a.id),
    };
  });

  return { portfolioValue: overview.totals.value, candidates, meta, accounts: accountRows };
}
