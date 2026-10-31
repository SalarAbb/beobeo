/**
 * Time a page load as a persona and list the requests it waited on, last to
 * finish first. The sim's `page:` latency is "until the network is idle"
 * (500ms with nothing in flight), so this shows which request a slow page
 * was really waiting for. Each run is a fresh browser context (cold client
 * cache); the server's caches stay warm between runs.
 * Run: pnpm --filter @beobeo/sim probe --persona gilderoy [--route /dashboard] [--runs 2]
 */
import "../src/env";
import { AppClient, APP_URL } from "../src/app/client";
import { deviceStorage, launchBrowser, newContext } from "../src/app/browser";
import { loadPersonas, simEmail, simPassword } from "../src/persona";

const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const persona = opt("persona") ?? "gilderoy";
const route = opt("route") ?? "/dashboard";
const runs = Number(opt("runs") ?? 2);
const p = loadPersonas().find((x) => x.id === persona);
if (!p) throw new Error(`unknown persona ${persona}`);
const client = new AppClient();
await client.signIn(simEmail(persona), simPassword(persona));
const browser = await launchBrowser();
for (let r = 0; r < runs; r++) {
  const ctx = await newContext(browser, { viewport: "desktop", scheme: "light", cookies: client.cookieList, storage: deviceStorage(p, client.userId) });
  const page = await ctx.newPage();
  const t0 = performance.now();
  const reqs = new Map<object, { url: string; start: number }>();
  const done: { url: string; start: number; end: number; status: string }[] = [];
  page.on("request", (q) => reqs.set(q, { url: q.url(), start: performance.now() - t0 }));
  const finish = (q: object, status: string) => {
    const s = reqs.get(q);
    if (s) done.push({ ...s, end: performance.now() - t0, status });
  };
  page.on("requestfinished", (q) => finish(q, "ok"));
  page.on("requestfailed", (q) => finish(q, `failed (${q.failure()?.errorText ?? "?"})`));
  await page.goto(`${APP_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const dcl = performance.now() - t0;
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  const idle = performance.now() - t0;
  console.log(`run ${r + 1}: domcontentloaded ${Math.round(dcl)}ms · networkidle ${Math.round(idle)}ms`);
  for (const d of done.sort((a, b) => b.end - a.end).slice(0, 14)) {
    const u = d.url.replace(APP_URL, "").slice(0, 150);
    console.log(`  ${String(Math.round(d.start)).padStart(5)} → ${String(Math.round(d.end)).padStart(5)}  ${String(Math.round(d.end - d.start)).padStart(5)}ms ${d.status} ${u}`);
  }
  await ctx.close();
}
await browser.close();
process.exit(0);
