import { and, asc, eq, inArray, like } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { db, schema } from "@beobeo/db";
import { MarketDataService, TiingoProvider } from "@beobeo/market-data";
import type { DividendBook } from "./dividends";
import { Holdings } from "./holdings";
import type { Instrument, Persona } from "./persona";
import { fmtQty, PriceBook, type IsoDate } from "./world";

/** Every sim account lives under this reserved domain — `sim:reset` deletes exactly these. */
export const SIM_EMAIL_PATTERN = "sim+%@beobeo.sim";
export const SIM_SOURCE = "sim";

export interface SimUser {
  userId: string;
  /** account name → account id */
  accounts: Map<string, string>;
}

export interface AssetRow {
  id: string;
  symbol: string;
  class: "stock" | "etf" | "fund" | "crypto" | "cash";
  providerRef: string | null;
}

/**
 * Create (or recreate) a persona's user directly in the DB — used by
 * bootstrap, where years of history are inserted at once. Fresh sign-ups
 * of *new* personas go through the real UI instead (see browser.ts).
 */
export async function recreateSimUser(persona: Persona, email: string, password: string): Promise<SimUser> {
  await db.delete(schema.user).where(eq(schema.user.email, email));
  const userId = crypto.randomUUID();
  await db.insert(schema.user).values({ id: userId, name: persona.name, email, emailVerified: true });
  await db.insert(schema.account).values({
    id: crypto.randomUUID(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: await hashPassword(password),
  });
  const portfolioIds = new Map<string, string>();
  for (const name of ["Main", ...(persona.portfolios ?? []).map((p) => p.name)]) {
    const [row] = await db.insert(schema.portfolios).values({ userId, name }).returning({ id: schema.portfolios.id });
    portfolioIds.set(name, row!.id);
  }
  const rows = await db
    .insert(schema.accounts)
    .values(
      persona.accounts.map((a) => ({
        userId,
        portfolioId: portfolioIds.get(a.portfolio ?? "Main")!,
        name: a.name,
        institution: a.institution,
        accountType: a.type,
      })),
    )
    .returning();
  await db.insert(schema.taxProfiles).values({
    userId,
    portfolioKey: "all",
    federalOrdinaryRatePct: String(persona.tax.ordinaryRate),
    federalLtcgRatePct: String(persona.tax.ltcgRate),
  });
  // Another taxpayer's portfolio (a kid's custodial account) keeps its own rates.
  for (const p of persona.portfolios ?? []) {
    await db.insert(schema.taxProfiles).values({
      userId,
      portfolioKey: portfolioIds.get(p.name)!,
      federalOrdinaryRatePct: String(p.tax.ordinaryRate),
      federalLtcgRatePct: String(p.tax.ltcgRate),
    });
  }
  return { userId, accounts: new Map(rows.map((r) => [r.name, r.id])) };
}

/**
 * A disposable twin of a persona's account for missions: same portfolios, accounts, trades and tax
 * profiles, under `sim+<id>-m@beobeo.sim`, recreated before every mission. Missions really use the
 * app (save, edit, delete, import), and none of that may touch the persona's own history, which the
 * daily habits keep building on. `empty` makes a brand-new sign-up instead (no portfolios, accounts,
 * trades or tax profile), for first-run missions: a setup run on a copied history reported the
 * persona's own VOO as "doubled" and its own accounts as "pre-existing" (hermione, missions 21–33).
 */
export async function cloneSimUser(
  sourceUserId: string,
  persona: Persona,
  email: string,
  password: string,
  opts: { empty?: boolean } = {},
): Promise<SimUser> {
  await db.delete(schema.user).where(eq(schema.user.email, email));
  const userId = crypto.randomUUID();
  await db.insert(schema.user).values({ id: userId, name: persona.name, email, emailVerified: true });
  await db.insert(schema.account).values({ id: crypto.randomUUID(), accountId: userId, providerId: "credential", userId, password: await hashPassword(password) });
  if (opts.empty) return { userId, accounts: new Map() };

  const portfolioMap = new Map<string, string>();
  for (const { id, userId: _u, createdAt: _c, ...rest } of await db.select().from(schema.portfolios).where(eq(schema.portfolios.userId, sourceUserId))) {
    const [row] = await db.insert(schema.portfolios).values({ ...rest, userId }).returning({ id: schema.portfolios.id });
    portfolioMap.set(id, row!.id);
  }
  const accountMap = new Map<string, string>();
  const accounts = new Map<string, string>();
  for (const { id, userId: _u, createdAt: _c, portfolioId, ...rest } of await db.select().from(schema.accounts).where(eq(schema.accounts.userId, sourceUserId))) {
    const [row] = await db
      .insert(schema.accounts)
      .values({ ...rest, userId, portfolioId: portfolioId ? (portfolioMap.get(portfolioId) ?? null) : null })
      .returning({ id: schema.accounts.id });
    accountMap.set(id, row!.id);
    accounts.set(rest.name, row!.id);
  }
  const txns = await db.select().from(schema.transactions).where(eq(schema.transactions.userId, sourceUserId));
  const copies = txns.map(({ id: _i, userId: _u, createdAt: _c, accountId, ...rest }) => ({ ...rest, userId, accountId: accountMap.get(accountId)! }));
  for (let i = 0; i < copies.length; i += 500) await db.insert(schema.transactions).values(copies.slice(i, i + 500));
  for (const { id: _i, userId: _u, portfolioKey, ...rest } of await db.select().from(schema.taxProfiles).where(eq(schema.taxProfiles.userId, sourceUserId))) {
    await db.insert(schema.taxProfiles).values({ ...rest, userId, portfolioKey: portfolioMap.get(portfolioKey) ?? portfolioKey });
  }
  return { userId, accounts };
}

export async function findUserId(email: string): Promise<string | null> {
  const [u] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email));
  return u?.id ?? null;
}

export async function loadSimUser(userId: string): Promise<SimUser> {
  const rows = await db.select().from(schema.accounts).where(eq(schema.accounts.userId, userId));
  return { userId, accounts: new Map(rows.map((r) => [r.name, r.id])) };
}

/** Find-or-create the shared asset rows for a persona universe. */
export async function ensureAssets(instruments: Instrument[]): Promise<Map<string, AssetRow>> {
  const uniq = [...new Map(instruments.map((i) => [`${i.symbol}:${i.class}`, i])).values()];
  if (uniq.length > 0) {
    await db
      .insert(schema.assets)
      .values(uniq.map((i) => ({ symbol: i.symbol, name: i.name, class: i.class })))
      .onConflictDoNothing();
  }
  const rows = await db
    .select()
    .from(schema.assets)
    .where(inArray(schema.assets.symbol, uniq.map((i) => i.symbol)));
  const wanted = new Set(uniq.map((i) => `${i.symbol}:${i.class}`));
  return new Map(
    rows.filter((r) => wanted.has(`${r.symbol}:${r.class}`)).map((r) => [r.symbol, r as AssetRow]),
  );
}

let market: MarketDataService | null = null;
export function marketData(): MarketDataService {
  return (market ??= new MarketDataService(db, {
    tiingoApiKey: process.env.TIINGO_API_KEY || undefined,
    alphaVantageApiKey: process.env.ALPHA_VANTAGE_API_KEY || undefined,
    coinGeckoApiKey: process.env.COINGECKO_API_KEY || undefined,
  }));
}

/** Real closes for the universe via the app's own cache-first market data service. */
export async function loadPriceBook(assets: AssetRow[], from: IsoDate, to: IsoDate): Promise<PriceBook> {
  const series = await marketData().getPricesBulk(
    assets.map((a) => ({ id: a.id, symbol: a.symbol, class: a.class, providerRef: a.providerRef })),
    from,
    to,
  );
  const bySymbol = new Map<string, Map<IsoDate, number>>();
  for (const a of assets) {
    const s = series.get(a.id) ?? new Map();
    bySymbol.set(a.symbol, new Map([...s].map(([d, c]) => [d as string, c.toNumber()])));
  }
  return new PriceBook(bySymbol);
}

/**
 * Real cash dividends per share for the universe's non-crypto members, straight
 * from Tiingo (the app's service only serves a trailing year). A symbol whose
 * fetch fails simply pays nothing, and the run goes on.
 */
export async function loadDividendBook(universe: Instrument[], from: IsoDate, to: IsoDate): Promise<DividendBook> {
  const book: DividendBook = new Map();
  const key = process.env.TIINGO_API_KEY;
  if (!key) return book;
  const tiingo = new TiingoProvider(key);
  for (const i of universe) {
    if (i.class === "crypto") continue;
    try {
      const rows = await tiingo.getDividends({ symbol: i.symbol, class: i.class }, from, to);
      book.set(i.symbol, new Map(rows.map((r) => [r.date, Number(r.amount)])));
    } catch (e) {
      console.warn(`    dividends for ${i.symbol} unavailable: ${(e as Error).message}`);
    }
  }
  return book;
}

export interface NewTxn {
  accountId: string;
  assetId: string;
  /** A dividend is quantity 1 × its cash, as the importers write it. */
  type: "buy" | "sell" | "dividend";
  qty: number;
  price: number;
  tradedAt: Date;
  note: string;
  isCrypto: boolean;
}

export async function insertTxns(userId: string, txns: NewTxn[]): Promise<void> {
  for (let i = 0; i < txns.length; i += 1000) {
    await db.insert(schema.transactions).values(
      txns.slice(i, i + 1000).map((t) => ({
        userId,
        accountId: t.accountId,
        assetId: t.assetId,
        type: t.type,
        quantity: fmtQty(t.qty, t.isCrypto),
        pricePerUnit: t.price.toFixed(t.price < 1 ? 8 : 4),
        fees: "0",
        tradedAt: t.tradedAt,
        note: t.note,
        source: SIM_SOURCE,
      })),
    );
  }
}

/**
 * Rebuild the persona's mental ledger from what the app actually stores —
 * so day N's decisions start from the real record, including any trades
 * the persona made through the UI.
 */
export async function loadHoldings(sim: SimUser): Promise<{ holdings: Holdings; lastTradeDate: IsoDate | null }> {
  const accountName = new Map([...sim.accounts].map(([n, id]) => [id, n]));
  const rows = await db
    .select({ txn: schema.transactions, symbol: schema.assets.symbol, class: schema.assets.class })
    .from(schema.transactions)
    .innerJoin(schema.assets, eq(schema.transactions.assetId, schema.assets.id))
    .where(and(eq(schema.transactions.userId, sim.userId)))
    .orderBy(asc(schema.transactions.tradedAt), asc(schema.transactions.createdAt));
  const crypto = new Set(rows.filter((r) => r.class === "crypto").map((r) => r.symbol));
  const holdings = new Holdings((s) => (crypto.has(s) ? 8 : 6));
  let last: IsoDate | null = null;
  for (const { txn, symbol } of rows) {
    if (txn.type !== "buy" && txn.type !== "sell") continue;
    holdings.apply({
      type: txn.type,
      account: accountName.get(txn.accountId) ?? "?",
      symbol,
      qty: Number(txn.quantity),
      price: Number(txn.pricePerUnit ?? 0),
    });
    last = txn.tradedAt.toISOString().slice(0, 10);
  }
  return { holdings, lastTradeDate: last };
}

export async function deleteSimUsers(): Promise<number> {
  const rows = await db.delete(schema.user).where(like(schema.user.email, SIM_EMAIL_PATTERN)).returning();
  return rows.length;
}
