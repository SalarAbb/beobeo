import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { Persona } from "../persona";
import { APP_URL } from "./client";

/** Prefer the installed Google Chrome (no browser download); fall back to Playwright's Chromium. */
export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

export type Viewport = "desktop" | "mobile";
export type Scheme = "light" | "dark";

const VIEWPORTS: Record<Viewport, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 400, height: 860 },
};

export async function newContext(
  browser: Browser,
  opts: {
    viewport: Viewport;
    scheme: Scheme;
    cookies?: { name: string; value: string }[];
    /** localStorage the persona's own device would hold (see `deviceStorage`). */
    storage?: Record<string, string>;
  },
): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: VIEWPORTS[opts.viewport],
    colorScheme: opts.scheme,
    deviceScaleFactor: 1,
  });
  if (opts.cookies?.length) {
    await ctx.addCookies(opts.cookies.map((c) => ({ ...c, url: APP_URL })));
  }
  if (opts.storage && Object.keys(opts.storage).length > 0) {
    await ctx.addInitScript((entries: Record<string, string>) => {
      for (const [k, v] of Object.entries(entries)) {
        if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
      }
    }, opts.storage);
  }
  return ctx;
}

/**
 * Settings a persona has saved on their device. A persona with a `rebalance`
 * rule has a target mix, so the dashboard's Allocation section starts with it
 * set (the app keeps target mixes in localStorage for now).
 */
export function deviceStorage(p: Persona, userId: string | null): Record<string, string> {
  const rule = p.policy.find((r) => r.kind === "rebalance");
  if (!userId || !rule || rule.kind !== "rebalance") return {};
  const pcts = Object.fromEntries(
    Object.entries(rule.targets).map(([sym, w]) => [sym, Math.round(w * 10000) / 100]),
  );
  return { [`beobeo.targets.${userId}.all`]: JSON.stringify(pcts) };
}

/** Navigate and wait until the page has settled; returns ms until settled. */
async function visit(page: Page, route: string): Promise<number> {
  const t0 = performance.now();
  await page.goto(`${APP_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  return performance.now() - t0;
}

export interface Shot {
  route: string;
  file: string;
  ms: number;
  viewport: Viewport;
  scheme: Scheme;
  finalUrl: string;
}

export async function walkthrough(
  ctx: BrowserContext,
  routes: string[],
  outDir: string,
  tag: string,
  /** CSS selector clicked (first match) after each route loads, e.g. to open a dialog. */
  click?: string,
): Promise<Shot[]> {
  const page = await ctx.newPage();
  const shots: Shot[] = [];
  const vp = page.viewportSize()?.width === VIEWPORTS.mobile.width ? "mobile" : "desktop";
  for (const route of routes) {
    const ms = await visit(page, route);
    if (click) {
      await page.locator(click).first().click({ timeout: 10_000 });
      await page.waitForTimeout(1_500);
    }
    const file = join(outDir, `${tag}-${route.replaceAll("/", "_") || "_root"}${click ? "-click" : ""}.png`);
    await page.screenshot({ path: file, fullPage: true });
    shots.push({ route, file, ms, viewport: vp, scheme: tag.includes("dark") ? "dark" : "light", finalUrl: page.url() });
  }
  await page.close();
  return shots;
}

export interface SignupResult {
  ok: boolean;
  ms: number;
  error?: string;
  shots: Shot[];
  landedOn?: string;
}

/**
 * Register through the real sign-up form — the first-run experience is part
 * of the product. Screenshots the form, the filled form, and where it lands.
 */
export async function signUpViaUi(
  ctx: BrowserContext,
  user: { name: string; email: string; password: string },
  outDir: string,
  tag: string,
): Promise<SignupResult> {
  const page = await ctx.newPage();
  const shots: Shot[] = [];
  const shot = async (label: string, ms: number) => {
    const file = join(outDir, `${tag}-signup-${label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    shots.push({ route: `/signup#${label}`, file, ms, viewport: "desktop", scheme: "light", finalUrl: page.url() });
  };
  const t0 = performance.now();
  try {
    const loadMs = await visit(page, "/signup");
    await shot("form", loadMs);
    await page.fill("#name", user.name);
    await page.fill("#email", user.email);
    await page.fill("#password", user.password);
    await page.getByRole("button", { name: /create account/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/signup"), { timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    const ms = performance.now() - t0;
    await shot("landing", ms);
    return { ok: true, ms, shots, landedOn: new URL(page.url()).pathname };
  } catch (e) {
    await shot("error", performance.now() - t0).catch(() => undefined);
    return { ok: false, ms: performance.now() - t0, error: (e as Error).message, shots };
  } finally {
    await page.close();
  }
}
