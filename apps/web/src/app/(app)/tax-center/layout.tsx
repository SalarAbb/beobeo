import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";
import { INCOME_COOKIE, parseIncomeCookie } from "@/lib/income-cookie";
import { PORTFOLIO_COOKIE } from "@/lib/portfolio-cookie";
import { warm } from "@/server/cache";
import { computeTaxLotsList, computeTaxNow, computeTaxProfile } from "@/server/tax-center";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Starts the Tax Center's computations while the page itself is still
 * loading, like the dashboard's layout: the client page's first batch
 * (tax.now, tax.lots, tax.profile) joins these runs instead of starting
 * cold. A brand-new account sat on "Working out your tax picture…" after
 * setup (hermione, missions 41/42). The income lives on the device; its
 * cookie mirror (`lib/income-cookie.ts`) lets tax.now warm with the exact
 * input the page sends (with an income saved, the batch took ~390ms instead
 * of ~80ms because tax.now missed the warm-up). Nothing is awaited.
 */
export default async function TaxCenterLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    const jar = await cookies();
    const stored = jar.get(PORTFOLIO_COOKIE)?.value;
    const portfolioId = stored && UUID.test(stored) ? stored : undefined;
    const income = parseIncomeCookie(jar.get(INCOME_COOKIE)?.value, session.user.id);
    warm(() => computeTaxNow(session.user.id, portfolioId, income));
    warm(() => computeTaxLotsList(session.user.id, portfolioId));
    warm(() => computeTaxProfile(session.user.id, portfolioId));
  }
  return children;
}
