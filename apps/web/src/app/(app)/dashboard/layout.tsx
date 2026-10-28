import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";
import { PORTFOLIO_COOKIE } from "@/lib/portfolio-cookie";
import { warm } from "@/server/cache";
import { computeMetrics, computeOverview } from "@/server/portfolio";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Starts the dashboard's computations while the page itself is still
 * loading. The page is a client component, so its first tRPC batch only
 * leaves the browser after the HTML, the JS and hydration; by then the
 * overview and the timeseries (via the metrics) are cached or in flight,
 * and the batch joins them instead of starting cold. Nothing is awaited.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    const stored = (await cookies()).get(PORTFOLIO_COOKIE)?.value;
    const portfolioId = stored && UUID.test(stored) ? stored : undefined;
    warm(() => computeOverview(session.user.id, portfolioId, "all"));
    warm(() => computeMetrics(session.user.id, portfolioId, "all"));
  }
  return children;
}
