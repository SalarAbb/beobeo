import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";
import { PORTFOLIO_COOKIE } from "@/lib/portfolio-cookie";
import { warm } from "@/server/cache";
import {
  loadAccountList,
  loadTransactionAssets,
  loadTransactionList,
} from "@/server/transactions-list";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Starts the Transactions page's reads (the newest 200 rows, the asset filter,
 * the accounts) while the page itself is still loading, like the dashboard's
 * layout: the page's first batch then joins them instead of sending four cold
 * queries down the serializing Neon driver (~520ms). Nothing is awaited.
 */
export default async function TransactionsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    const userId = session.user.id;
    const stored = (await cookies()).get(PORTFOLIO_COOKIE)?.value;
    const portfolioId = stored && UUID.test(stored) ? stored : undefined;
    warm(() => loadTransactionList(userId, { portfolioId, limit: 200 }));
    warm(() => loadTransactionAssets(userId, portfolioId));
    warm(() => loadAccountList(userId, portfolioId));
  }
  return children;
}
