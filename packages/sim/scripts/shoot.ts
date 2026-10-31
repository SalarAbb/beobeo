/**
 * Screenshot routes as a persona — light + dark desktop and light mobile —
 * so /evolve (or a human) can see a change the way personas will.
 *
 * Run: pnpm --filter @beobeo/sim shoot --persona samwell --routes /dashboard,/tax-center [--out DIR]
 *      [--click '<css> | <css>']   (clicked in order after each route loads, e.g. to open a dialog)
 *      [--income 42000]            (as if typed into Tax Profile → Your income)
 *      [--pay 55000]               (pay typed there instead; its taxable part is worked out)
 *      [--band 211400]            (as if setup's band with that lower edge was tapped, no pay)
 */
import "../src/env";
import { taxableFromPay } from "@beobeo/core/tax-brackets";
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
const band = opt("band"); // a setup band tapped instead of typing pay (its lower edge)
const pay = opt("pay"); // pay typed into Tax Profile → Your income (its taxable part is worked out)
const storage = deviceStorage(
  p,
  client.userId,
  pay ? taxableFromPay(p.tax.filingStatus, Number(pay)) : income ? Number(income) : undefined,
  band ? Number(band) : undefined,
  pay ? Number(pay) : undefined,
);
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
