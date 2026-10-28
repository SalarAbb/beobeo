import { cookies, headers } from "next/headers";
import { ComparePresetsProvider } from "@/components/compare-presets";
import { auth } from "@/lib/auth";
import { PORTFOLIO_COOKIE } from "@/lib/portfolio-cookie";
import { loadBenchmarkPresets, type BenchmarkPreset } from "@/server/benchmark-presets";
import { warm } from "@/server/cache";
import { computeDcaComparison, computeOverview } from "@/server/portfolio";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Hands the page its preset benchmarks (resolved once per process, so this
 * await is instant after the first visit) and starts the default comparison
 * (the first preset, whole portfolio) plus the overview while the page loads.
 * Before, the page asked for the presets, waited, and only then started the
 * comparison: two round trips in a row (minerva, page:/compare ~1.4–2s).
 * Benchmark picks live on the device, so a custom selection is warmed by the
 * nav's hover prefetch instead. Nothing but the presets is awaited.
 */
export default async function CompareLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  let presets: BenchmarkPreset[] | undefined;
  if (session) {
    presets = await loadBenchmarkPresets().catch(() => undefined); // the page fetches them itself
    const stored = (await cookies()).get(PORTFOLIO_COOKIE)?.value;
    const portfolioId = stored && UUID.test(stored) ? stored : undefined;
    const first = presets?.[0];
    if (first) warm(() => computeDcaComparison(session.user.id, { benchmarkIds: [first.id], portfolioId }));
    warm(() => computeOverview(session.user.id, portfolioId, "all"));
  }
  return <ComparePresetsProvider presets={presets}>{children}</ComparePresetsProvider>;
}
