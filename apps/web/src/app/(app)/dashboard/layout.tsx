import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";
import { defaultNextBuyIds } from "@/lib/next-buy-defaults";
import { PORTFOLIO_COOKIE } from "@/lib/portfolio-cookie";
import { warm } from "@/server/cache";
import { computeDividendEstimate } from "@/server/dividends";
import { computeNextBuy } from "@/server/next-buy";
import { computeMetrics, computeOverview } from "@/server/portfolio";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Starts the dashboard's computations while the page itself is still
 * loading. The page is a client component, so its first tRPC batch only
 * leaves the browser after the HTML, the JS and hydration; by then the
 * overview and the timeseries (via the metrics) are cached or in flight,
 * and the batch joins them instead of starting cold. The next-buy candidates
 * the page starts from (its three largest holdings) are gathered too: the
 * page can only ask once the batch is back, so cold that was a second round
 * trip after it (~1.1s). The dividend estimate is the same: its section asks
 * only once the overview is in, and cold that took ~600ms more. Nothing is
 * awaited.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    const userId = session.user.id;
    const stored = (await cookies()).get(PORTFOLIO_COOKIE)?.value;
    const portfolioId = stored && UUID.test(stored) ? stored : undefined;
    warm(() => computeOverview(userId, portfolioId, "all"));
    warm(() => computeMetrics(userId, portfolioId, "all"));
    warm(() => computeDividendEstimate(userId, portfolioId));
    // Only the default options matter here: the amount and a device-saved target
    // mix just re-rank the cached candidates.
    warm(async () => {
      const overview = await computeOverview(userId, portfolioId, "all");
      const assetIds = defaultNextBuyIds(overview.holdings);
      if (assetIds.length > 0) await computeNextBuy(userId, { portfolioId, amountUsd: 1, assetIds });
    });
  }
  return children;
}
