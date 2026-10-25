import { join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { isSafeTarget, pickWeighted, routeKey, type ExploreProfile } from "../explore-rules";
import { APP_URL } from "./client";
import type { Shot } from "./browser";

export interface ExploreStep {
  i: number;
  action: "goto" | "click" | "fill" | "escape";
  target: string;
  from: string;
  to: string;
  ms: number;
  error?: string;
}

export interface ExploreResult {
  steps: ExploreStep[];
  /** Uncaught page errors, 5xx responses and failed tRPC calls, per route. */
  errors: { route: string; message: string }[];
  /** Buttons with no accessible name, per route (can't be read by screen readers, or by us). */
  unlabeled: Map<string, number>;
  /** First full-page screenshot of each distinct route visited (max 4). */
  shots: Shot[];
}

interface Candidate {
  id: number;
  kind: "click" | "fill";
  name: string;
  role: string | null;
  href: string | null;
  tag: string;
  inputType: string | null;
}

/** Tag every visible interactive element and describe it; also count unlabeled buttons. */
async function scan(page: Page): Promise<{ candidates: Candidate[]; unlabeled: number }> {
  return page.evaluate(() => {
    const out: Candidate[] = [];
    let unlabeled = 0;
    const els = document.querySelectorAll<HTMLElement>(
      "a[href], button, [role=tab], [role=button], [role=menuitem], summary, input, textarea, select",
    );
    let id = 0;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || style.visibility === "hidden" || (el as HTMLButtonElement).disabled) continue;
      const tag = el.tagName.toLowerCase();
      const isInput = tag === "input" || tag === "textarea";
      const inputType = isInput ? ((el as HTMLInputElement).type || "text") : null;
      if (isInput && !["text", "search", "number", ""].includes(inputType ?? "")) continue;
      const name = (
        (isInput ? el.getAttribute("aria-label") || el.getAttribute("placeholder") || (el as HTMLInputElement).name : el.innerText) ||
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60);
      if (!name && tag === "button") unlabeled++;
      el.setAttribute("data-sim-id", String(id));
      out.push({
        id: id++,
        kind: isInput ? "fill" : "click",
        name,
        role: el.getAttribute("role"),
        href: tag === "a" ? el.getAttribute("href") : null,
        tag,
        inputType,
      });
    }
    return { candidates: out, unlabeled };
  });
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
}

/**
 * A persona wandering the app: jump to areas they gravitate to, click things
 * that look interesting, type into search/amount boxes, close dialogs.
 * Seeded, so a surprising session can be replayed exactly.
 */
export async function explore(
  ctx: BrowserContext,
  o: { rng: () => number; profile: ExploreProfile; symbols: string[]; outDir: string; tag: string },
): Promise<ExploreResult> {
  const page = await ctx.newPage();
  const res: ExploreResult = { steps: [], errors: [], unlabeled: new Map(), shots: [] };
  const here = () => routeKey(new URL(page.url()).pathname);
  page.on("pageerror", (e) => res.errors.push({ route: here(), message: e.message.slice(0, 300) }));
  page.on("response", (r) => {
    const u = r.url();
    if (r.status() >= 500 || (u.includes("/api/trpc") && r.status() >= 400 && r.status() !== 401)) {
      res.errors.push({ route: here(), message: `${r.status()} ${new URL(u).pathname}`.slice(0, 300) });
    }
  });
  const pick = <T>(xs: T[]) => xs[Math.floor(o.rng() * xs.length)]!;
  const seen = new Set<string>();
  const routes = Object.entries(o.profile.affinity).map(([item, weight]) => ({ item, weight }));

  const after = async (step: Omit<ExploreStep, "to" | "ms">, t0: number) => {
    await settle(page);
    const to = here();
    res.steps.push({ ...step, to, ms: Math.round(performance.now() - t0) });
    if (!seen.has(to) && !page.url().includes("/signin")) {
      seen.add(to);
      const { unlabeled } = await scan(page).catch(() => ({ unlabeled: 0 }));
      if (unlabeled > 0) res.unlabeled.set(to, unlabeled);
      if (res.shots.length < 4) {
        const file = join(o.outDir, `${o.tag}-explore-${res.shots.length + 1}${to.replace(/[/:]+/g, "_")}.png`);
        await page.screenshot({ path: file, fullPage: true }).catch(() => undefined);
        res.shots.push({ route: to, file, ms: Math.round(performance.now() - t0), viewport: "desktop", scheme: "light", finalUrl: page.url() });
      }
    }
  };

  // Every session starts where this persona usually lands.
  const start = pickWeighted(o.rng, routes) ?? "/dashboard";
  let t0 = performance.now();
  await page.goto(`${APP_URL}${start}`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  await after({ i: 0, action: "goto", target: start, from: "(arrive)" }, t0);

  for (let i = 1; i <= o.profile.steps; i++) {
    const from = here();
    const roll = o.rng();
    t0 = performance.now();
    try {
      if (roll < 0.15) {
        const route = pickWeighted(o.rng, routes) ?? "/dashboard";
        await page.goto(`${APP_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await after({ i, action: "goto", target: route, from }, t0);
        continue;
      }
      if (roll < 0.25) {
        await page.keyboard.press("Escape");
        await after({ i, action: "escape", target: "Escape", from }, t0);
        continue;
      }
      const { candidates } = await scan(page);
      const safe = candidates.filter((c) => isSafeTarget(c));
      const fills = safe.filter((c) => c.kind === "fill");
      const clicks = safe.filter((c) => c.kind === "click");
      const c = roll < 0.4 && fills.length ? pick(fills) : clicks.length ? pick(clicks) : null;
      if (!c) continue;
      const loc = page.locator(`[data-sim-id="${c.id}"]`).first();
      if (c.kind === "fill") {
        const value = c.inputType === "number" ? pick(["500", "2500", "10000", "25000"]) : pick(o.symbols);
        await loc.fill(value, { timeout: 3_000 });
        await after({ i, action: "fill", target: `${c.name} = ${value}`, from }, t0);
      } else {
        await loc.click({ timeout: 3_000 });
        await after({ i, action: "click", target: c.name, from }, t0);
      }
    } catch (e) {
      res.steps.push({ i, action: "click", target: "(failed)", from, to: from, ms: Math.round(performance.now() - t0), error: (e as Error).message.split("\n")[0]!.slice(0, 200) });
    }
  }
  await page.close();
  return res;
}
