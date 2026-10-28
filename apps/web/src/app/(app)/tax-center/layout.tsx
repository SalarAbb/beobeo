import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";
import { PORTFOLIO_COOKIE } from "@/lib/portfolio-cookie";
import { warm } from "@/server/cache";
import { computeTaxLotsList, computeTaxNow, computeTaxProfile } from "@/server/tax-center";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Starts the Tax Center's computations while the page itself is still
 * loading, like the dashboard's layout: the client page's first batch
 * (tax.now, tax.lots, tax.profile) joins these runs instead of starting
 * cold. A brand-new account sat on "Working out your tax picture…" after
 * setup (hermione, missions 41/42). The income lives on the device, so
 * tax.now is warmed without it; with an income saved, that query still
 * joins the lots and profile loads while they run. Nothing is awaited.
 */
export default async function TaxCenterLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    const stored = (await cookies()).get(PORTFOLIO_COOKIE)?.value;
    const portfolioId = stored && UUID.test(stored) ? stored : undefined;
    warm(() => computeTaxNow(session.user.id, portfolioId));
    warm(() => computeTaxLotsList(session.user.id, portfolioId));
    warm(() => computeTaxProfile(session.user.id, portfolioId));
  }
  return children;
}
