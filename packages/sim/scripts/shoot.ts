/**
 * Screenshot routes as a persona — light + dark desktop and light mobile —
 * so /evolve (or a human) can see a change the way personas will.
 *
 * Run: pnpm --filter @beobeo/sim shoot --persona samwell --routes /dashboard,/tax-center [--out DIR]
 *      [--click '<css> | <css>']   (clicked in order after each route loads, e.g. to open a dialog)
 *      [--income 42000]            (as if typed into Tax Profile → Your income)
 */
import "../src/env";
import { AppClient } from "../src/app/client";
import { deviceStorage, launchBrowser, newContext, walkthrough } from "../src/app/browser";
import { simDir } from "../src/journal";
import { loadPersonas, simEmail, simPassword } from "../src/persona";
import { todayIso } from "../src/world";

const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const persona = opt("persona") ?? "samwell";
const routes = (opt("routes") ?? "/dashboard").split(",");
const out = opt("out") ?? simDir("screenshots", todayIso(), "evolve");
const click = opt("click");
const income = opt("income"); // taxable income typed into Tax Profile → Your income

const p = loadPersonas().find((x) => x.id === persona);
if (!p) throw new Error(`unknown persona ${persona}`);
const client = new AppClient();
await client.signIn(simEmail(persona), simPassword(persona));
const browser = await launchBrowser();
const storage = deviceStorage(p, client.userId, income ? Number(income) : undefined);
for (const [viewport, scheme] of [["desktop", "light"], ["desktop", "dark"], ["mobile", "light"]] as const) {
  const ctx = await newContext(browser, {
    viewport, scheme, cookies: client.cookieList, storage,
  });
  for (const s of await walkthrough(ctx, routes, out, `${persona}-${viewport}-${scheme}`, click)) {
    console.log(`${s.file}  (${Math.round(s.ms)}ms${s.finalUrl.includes("/signin") ? ", NOT SIGNED IN" : ""})`);
  }
  await ctx.close();
}
await browser.close();
process.exit(0);
