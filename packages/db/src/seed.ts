/**
 * Seed a demo user with a realistic multi-asset transaction history.
 * Run: pnpm db:seed  (idempotent — wipes and recreates the demo user)
 *
 * Login: demo@beobeo.dev / demo-password-123
 */
import { config } from "dotenv";
config({ path: "../../.env" });

import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import * as schema from "./schema";

// Dynamic import so dotenv runs before the client reads DATABASE_URL
// (static imports are hoisted above the config() call).
const { db } = await import("./client");

const DEMO_EMAIL = "demo@beobeo.dev";
const DEMO_PASSWORD = "demo-password-123";

async function main() {
  // Wipe any previous demo user (cascades to accounts/transactions/threads).
  await db.delete(schema.user).where(eq(schema.user.email, DEMO_EMAIL));

  const userId = crypto.randomUUID();
  await db.insert(schema.user).values({
    id: userId,
    name: "Demo User",
    email: DEMO_EMAIL,
    emailVerified: true,
  });
  await db.insert(schema.account).values({
    id: crypto.randomUUID(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: await hashPassword(DEMO_PASSWORD),
  });

  const [mainPortfolio] = await db
    .insert(schema.portfolios)
    .values({ userId, name: "Main" })
    .returning();
  const [brokerage] = await db
    .insert(schema.accounts)
    .values({
      userId,
      portfolioId: mainPortfolio!.id,
      name: "Brokerage",
      institution: "Fidelity",
    })
    .returning();
  const [cryptoAcct] = await db
    .insert(schema.accounts)
    .values({
      userId,
      portfolioId: mainPortfolio!.id,
      name: "Crypto",
      institution: "Coinbase",
    })
    .returning();

  const assetRows = await db
    .insert(schema.assets)
    .values([
      { symbol: "AAPL", name: "Apple Inc.", class: "stock" as const },
      { symbol: "NVDA", name: "NVIDIA Corp.", class: "stock" as const },
      { symbol: "VOO", name: "Vanguard S&P 500 ETF", class: "etf" as const },
      { symbol: "SPY", name: "SPDR S&P 500 ETF", class: "etf" as const },
      { symbol: "BTC", name: "Bitcoin", class: "crypto" as const, providerRef: "bitcoin" },
      { symbol: "ETH", name: "Ethereum", class: "crypto" as const, providerRef: "ethereum" },
    ])
    .onConflictDoNothing()
    .returning();

  // onConflictDoNothing returns only inserted rows — fetch all six by symbol/class.
  const allAssets = await db.select().from(schema.assets);
  const bySymbol = new Map(allAssets.map((a) => [a.symbol, a]));
  const aapl = bySymbol.get("AAPL")!;
  const nvda = bySymbol.get("NVDA")!;
  const voo = bySymbol.get("VOO")!;
  const btc = bySymbol.get("BTC")!;
  const eth = bySymbol.get("ETH")!;

  const t = (
    accountId: string,
    assetId: string,
    type: (typeof schema.transactionType.enumValues)[number],
    quantity: string,
    pricePerUnit: string | null,
    tradedAt: string,
    fees = "0",
  ) => ({
    userId,
    accountId,
    assetId,
    type,
    quantity,
    pricePerUnit,
    fees,
    tradedAt: new Date(`${tradedAt}T15:30:00Z`),
    source: "seed",
  });

  await db.insert(schema.transactions).values([
    // AAPL: DCA buys, a partial sell (realized gain in 2025)
    t(brokerage!.id, aapl.id, "buy", "15", "185.20", "2024-02-05"),
    t(brokerage!.id, aapl.id, "buy", "10", "172.50", "2024-04-22", "1"),
    t(brokerage!.id, aapl.id, "buy", "12", "228.90", "2024-11-12"),
    t(brokerage!.id, aapl.id, "sell", "10", "255.40", "2025-06-18", "1.50"),
    t(brokerage!.id, aapl.id, "dividend", "1", "24.75", "2025-02-14"),

    // NVDA: bought before the 2024-06-10 10-for-1 split, sold some after
    t(brokerage!.id, nvda.id, "buy", "8", "790.00", "2024-03-01"),
    t(brokerage!.id, nvda.id, "split", "10", null, "2024-06-10"),
    t(brokerage!.id, nvda.id, "sell", "30", "135.30", "2024-12-20", "2"),
    t(brokerage!.id, nvda.id, "buy", "20", "118.60", "2025-04-08"),

    // VOO: steady monthly-ish DCA
    t(brokerage!.id, voo.id, "buy", "5", "455.10", "2024-01-16"),
    t(brokerage!.id, voo.id, "buy", "5", "471.80", "2024-05-14"),
    t(brokerage!.id, voo.id, "buy", "5", "512.30", "2024-09-17"),
    t(brokerage!.id, voo.id, "buy", "5", "548.75", "2025-01-21"),
    t(brokerage!.id, voo.id, "buy", "5", "530.20", "2025-05-13"),

    // BTC: two buys + one sell, high-precision quantities
    t(cryptoAcct!.id, btc.id, "buy", "0.25", "43850.00", "2024-01-29", "12"),
    t(cryptoAcct!.id, btc.id, "buy", "0.15", "67420.00", "2024-10-21", "9"),
    t(cryptoAcct!.id, btc.id, "sell", "0.1", "94100.00", "2025-03-05", "14"),

    // ETH: transfer in from a wallet (basis provided), small buy
    t(cryptoAcct!.id, eth.id, "transfer_in", "2", "2280.00", "2024-07-09"),
    t(cryptoAcct!.id, eth.id, "buy", "1.5", "3350.00", "2024-12-02", "6"),
  ]);

  console.log(`Seeded demo user ${DEMO_EMAIL} (id ${userId})`);
  console.log(`  accounts: Brokerage, Crypto`);
  console.log(`  assets: AAPL NVDA VOO SPY BTC ETH`);
  console.log(`  login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
