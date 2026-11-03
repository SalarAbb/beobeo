import {
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

// All monetary/quantity values are numeric (arbitrary precision) — never float.
// Crypto quantities need high fractional precision (satoshis, wei).
const quantity = (name: string) => numeric(name, { precision: 38, scale: 18 });
const money = (name: string) => numeric(name, { precision: 38, scale: 10 });

export const assetClass = pgEnum("asset_class", [
  "stock",
  "etf",
  "fund",
  "crypto",
  "cash",
]);

export const transactionType = pgEnum("transaction_type", [
  "buy",
  "sell",
  "dividend",
  "split",
  "transfer_in",
  "transfer_out",
  "fee",
]);

/**
 * Taxable vs. tax-advantaged — drives the Tax Center: only "taxable"
 * accounts are ever sold for the cash-raising/harvesting optimizer, and a
 * wash-sale replacement bought in any non-taxable type is PERMANENTLY
 * disallowed (Rev. Rul. 2008-5) rather than merely deferred.
 */
export const accountType = pgEnum("account_type", [
  "taxable",
  "traditional_ira",
  "roth_ira",
  "401k",
  "other_tax_advantaged",
]);

/**
 * How the broker matches a sale to purchases: oldest first (FIFO, the usual
 * broker default) or highest cost per unit first (HIFO, common at crypto
 * exchanges). Each account has one for stocks/funds and one for crypto (one
 * account can hold both, and brokers often treat them differently). Every
 * gain, cost and tax figure in the app follows it.
 */
export const lotMethod = pgEnum("lot_method", ["fifo", "hifo"]);

/** Named container grouping brokerage accounts ("Main", "Retirement", …). */
export const portfolios = pgTable(
  "portfolios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("portfolios_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Nullable only for pre-portfolio legacy rows; the app always sets it and
    // a backfill assigned "Main" to old rows. Treat null as "Main".
    portfolioId: uuid("portfolio_id").references(() => portfolios.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    institution: text("institution"),
    currency: text("currency").notNull().default("USD"),
    // Defaults taxable — the safe assumption for every existing account;
    // users flag IRAs/401ks explicitly on the /accounts page.
    accountType: accountType("account_type").notNull().default("taxable"),
    lotMethod: lotMethod("lot_method").notNull().default("fifo"),
    cryptoLotMethod: lotMethod("crypto_lot_method").notNull().default("fifo"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("accounts_user_idx").on(t.userId),
    index("accounts_portfolio_idx").on(t.portfolioId),
  ],
);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    class: assetClass("class").notNull(),
    currency: text("currency").notNull().default("USD"),
    // provider-specific identifier, e.g. CoinGecko coin id ("bitcoin")
    providerRef: text("provider_ref"),
  },
  (t) => [uniqueIndex("assets_symbol_class_idx").on(t.symbol, t.class)],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    type: transactionType("type").notNull(),
    // buy/sell/transfer: units of the asset. split: ratio (4 = 4-for-1).
    quantity: quantity("quantity").notNull(),
    // price per unit in account currency. null for splits.
    pricePerUnit: money("price_per_unit"),
    fees: money("fees").notNull().default("0"),
    tradedAt: timestamp("traded_at").notNull(),
    note: text("note"),
    // provenance: manual | csv:<preset> | snaptrade (later)
    source: text("source").notNull().default("manual"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("transactions_user_idx").on(t.userId),
    index("transactions_user_asset_idx").on(t.userId, t.assetId),
    index("transactions_traded_at_idx").on(t.tradedAt),
  ],
);

export const priceHistory = pgTable(
  "price_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    close: money("close").notNull(),
  },
  (t) => [uniqueIndex("price_history_asset_date_idx").on(t.assetId, t.date)],
);

/**
 * Corporate-action splits per asset, shared across users (like price_history).
 * Captured from providers (Tiingo splitFactor). ratio follows the transaction
 * convention: 4 = 4-for-1, 0.25 = 1-for-4 reverse. The close ON `date` is
 * already post-split. Used to synthesize split transactions for users who
 * never recorded one, and to split-adjust benchmark series for DCA replays.
 */
export const assetSplits = pgTable(
  "asset_splits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    ratio: quantity("ratio").notNull(),
  },
  (t) => [uniqueIndex("asset_splits_asset_date_idx").on(t.assetId, t.date)],
);

export const chatThreads = pgTable(
  "chat_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("chat_threads_user_idx").on(t.userId)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    // full content blocks (text + tool_use/tool_result) for agent replay
    content: jsonb("content").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("chat_messages_thread_idx").on(t.threadId)],
);

/** Percentage columns (0-100, not a fraction) — friendlier to read/edit
 *  directly; the Tax Center engine layer divides by 100 before use. */
const pct = (name: string) => numeric(name, { precision: 6, scale: 3 });

/**
 * Tax Center settings, keyed per TAXPAYER, not per user — a "portfolio" in
 * this app can represent a different taxpayer (a kid's custodial account,
 * a trust), so each portfolio (or "all", combining every portfolio) gets
 * its own independent profile. Mirrors the `portfolioKey` convention used
 * elsewhere: "all" or a real portfolios.id. Auto-created with these
 * defaults on first Tax Center visit for that scope.
 */
export const taxProfiles = pgTable(
  "tax_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    portfolioKey: text("portfolio_key").notNull().default("all"),
    federalOrdinaryRatePct: pct("federal_ordinary_rate_pct").notNull().default("24"),
    federalLtcgRatePct: pct("federal_ltcg_rate_pct").notNull().default("15"),
    stateOrdinaryRatePct: pct("state_ordinary_rate_pct").notNull().default("0"),
    // Equals stateOrdinaryRatePct in the UI whenever stateTreatsLtcgAsOrdinary
    // is true; stored independently so the two can diverge when it's false.
    stateLtcgRatePct: pct("state_ltcg_rate_pct").notNull().default("0"),
    stateTreatsLtcgAsOrdinary: boolean("state_treats_ltcg_as_ordinary")
      .notNull()
      .default(false),
    carryforwardShortTerm: money("carryforward_short_term").notNull().default("0"),
    carryforwardLongTerm: money("carryforward_long_term").notNull().default("0"),
    carryforwardDiscountPct: pct("carryforward_discount_pct").notNull().default("70"),
    // null = use the value computed from this scope's real transactions;
    // set = the user is telling us about gains/losses outside this app.
    ytdShortTermOverride: money("ytd_short_term_override"),
    ytdLongTermOverride: money("ytd_long_term_override"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tax_profiles_user_portfolio_idx").on(t.userId, t.portfolioKey)],
);
