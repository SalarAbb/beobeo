/**
 * "I have $n — where should it go?" (R-004): rank the user's own candidates
 * and name one, with one plain reason and the account it belongs in.
 *
 * Deterministic and explainable (principles 3, 8, 9): every score is a
 * weighted sum of two parts the UI can show back.
 *   fit — how well the buy fits what you hold. With a target mix, the share
 *         of the deposit the candidate is still short of its target (after
 *         the deposit grows the portfolio); untargeted or already-full
 *         candidates get 0. Without a target mix, 1 − its weight after the
 *         buy, so spreading money wins over piling onto the biggest holding.
 *         A single company or coin counts its weight double (1 − 2 × weight
 *         after, floored at 0): one company can fall alone in a way a fund of
 *         many can't. Counted equally, luna (67% VOO, 33% NVDA) was told NVDA
 *         "keeps your money more spread out" than an S&P 500 fund (mission 62).
 *   dip — how far it sits below its own trailing-year range (70%) and below
 *         what you paid for it (30%, full marks at 20% under your cost).
 * score = 0.6 × fit + 0.4 × dip without a target mix. With one, 0.9 × fit +
 * 0.1 × dip: the user has said where money should go, so the option furthest
 * short of its target comes first and the dip only settles near-ties (e.g.
 * two sleeves that can each take the whole amount). Under 0.6/0.4 a bond fund
 * 5% off its high outranked a sleeve twice as far short (minerva, mission 48).
 * Ties go to the lower weight after the buy, then the symbol, so the same
 * inputs always give the same pick.
 *
 * Plain numbers, like allocation.ts: values arrive Decimal→number from the
 * overview payload, and the output is a suggestion, not a ledger entry.
 */

import type { TargetMix } from "./allocation";

export const NEXT_BUY_WEIGHTS = { fit: 0.6, dip: 0.4 } as const;
/** With a target mix: the shortfall decides, the dip breaks near-ties. */
export const NEXT_BUY_TARGET_WEIGHTS = { fit: 0.9, dip: 0.1 } as const;
/** Inside the dip score: position in the 1-year range vs. under your cost. */
const RANGE_SHARE = 0.7;
/** Being this far under your average cost earns the full cost part. */
const FULL_COST_DIP = 0.2;
/** A dip reason needs at least this much off the 1-year high. */
const DIP_REASON_MIN = 0.05;
/** Under this weight a holding reads as small ("just 6% of your portfolio"). */
const SMALL_WEIGHT = 0.25;
/** Without a target mix, a single company or coin's weight counts this many
 *  times toward how lopsided the portfolio gets. */
export const SINGLE_NAME_WEIGHT = 2;
/** Classes that are one company or one coin, not a fund of many. */
const SINGLE_NAME_CLASSES = new Set(["stock", "crypto"]);

export type NextBuyAccountType =
  | "taxable"
  | "traditional_ira"
  | "roth_ira"
  | "401k"
  | "other_tax_advantaged";

export interface NextBuyAccount {
  id: string;
  name: string;
  type: NextBuyAccountType;
}

export interface NextBuyCandidate {
  key: string;
  assetClass: string;
  /** Latest price; null = no price known (scores no dip). */
  price: number | null;
  /** Lowest and highest close over the trailing year. */
  rangeLow: number | null;
  rangeHigh: number | null;
  /** The user's average cost per unit, when they hold it. */
  avgCost: number | null;
  /** Market value the user holds now (0 if new). */
  heldValue: number;
  /** Interest-heavy fund (bonds): taxed every year, so it belongs in a
   *  tax-advantaged account when there is one. */
  incomeHeavy?: boolean;
  /** Account ids that already hold it, most recent buy first. */
  heldIn?: string[];
}

export interface NextBuyPick {
  key: string;
  score: number;
  fit: number;
  dip: number;
  /** Share of the portfolio now and after putting the whole amount in. */
  weightNow: number;
  weightAfter: number;
  /** One company (a stock) or one coin, not a fund of many. */
  singleName: boolean;
  /** Target weight (fraction) when a target mix exists, else null. */
  target: number | null;
  /** Dollars still short of target after the deposit grows the total. */
  gapUsd: number | null;
  /** price ÷ 1-year high − 1 (≤ 0). */
  offHigh: number | null;
  /** 0 = at its 1-year low, 1 = at its high. */
  rangePosition: number | null;
  /** price ÷ your average cost − 1. */
  vsCost: number | null;
  /** One plain sentence: the strongest reason behind the score. */
  reason: string;
  account: { id: string; name: string; why: string | null } | null;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const usd = (x: number) =>
  `$${Math.round(x).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
const pctOf = (w: number) => `${Number((w * 100).toFixed(1))}%`;

/** Ranked best first; "Show me another" is simply the next entry. */
export function pickNextBuy(input: {
  amountUsd: number;
  /** Total market value of the portfolio the money goes into. */
  portfolioValue: number;
  candidates: NextBuyCandidate[];
  targets?: TargetMix | null;
  accounts?: NextBuyAccount[];
}): NextBuyPick[] {
  const { amountUsd, portfolioValue, candidates } = input;
  if (!(amountUsd > 0) || candidates.length === 0) return [];
  const targets =
    input.targets && Object.values(input.targets).some((w) => w > 0) ? input.targets : null;
  const totalAfter = portfolioValue + amountUsd;
  const weights = targets ? NEXT_BUY_TARGET_WEIGHTS : NEXT_BUY_WEIGHTS;

  const picks = candidates.map((c): NextBuyPick => {
    const weightNow = portfolioValue > 0 ? c.heldValue / portfolioValue : 0;
    const weightAfter = (c.heldValue + amountUsd) / totalAfter;
    const singleName = SINGLE_NAME_CLASSES.has(c.assetClass);

    let target: number | null = null;
    let gapUsd: number | null = null;
    let fit: number;
    if (targets) {
      target = targets[c.key] ?? 0;
      gapUsd = target * totalAfter - c.heldValue;
      fit = target > 0 ? clamp01(gapUsd / amountUsd) : 0;
    } else {
      fit = clamp01(1 - (singleName ? SINGLE_NAME_WEIGHT : 1) * weightAfter);
    }

    let rangePosition: number | null = null;
    let offHigh: number | null = null;
    let vsCost: number | null = null;
    let dip = 0;
    if (c.price !== null && c.price > 0) {
      if (c.rangeLow !== null && c.rangeHigh !== null && c.rangeHigh > c.rangeLow) {
        rangePosition = clamp01((c.price - c.rangeLow) / (c.rangeHigh - c.rangeLow));
      }
      if (c.rangeHigh !== null && c.rangeHigh > 0) {
        offHigh = Math.min(0, c.price / c.rangeHigh - 1);
      }
      if (c.avgCost !== null && c.avgCost > 0) vsCost = c.price / c.avgCost - 1;
      const rangeScore = rangePosition === null ? 0 : 1 - rangePosition;
      const costScore = vsCost !== null && vsCost < 0 ? Math.min(1, -vsCost / FULL_COST_DIP) : 0;
      dip = RANGE_SHARE * rangeScore + (1 - RANGE_SHARE) * costScore;
    }

    const score = weights.fit * fit + weights.dip * dip;
    const pick: NextBuyPick = {
      key: c.key,
      score,
      fit,
      dip,
      weightNow,
      weightAfter,
      singleName,
      target,
      gapUsd,
      offHigh,
      rangePosition,
      vsCost,
      reason: "",
      account: placeAccount(c, input.accounts ?? []),
    };
    pick.reason = reasonFor(pick, c, weights);
    return pick;
  });

  picks.sort(
    (a, b) =>
      b.score - a.score || a.weightAfter - b.weightAfter || a.key.localeCompare(b.key),
  );
  // "Already 67% of your portfolio" alone reads as a reason against a pick;
  // with other options, compare: the top pick spreads money more than the
  // runner-up, every other pick less than the top. When a fund beats a single
  // company or coin, that's the reason, so it's what the sentence says.
  const [top, second] = picks;
  if (top && second) {
    const one = (p: NextBuyPick) =>
      candidates.find((c) => c.key === p.key)?.assetClass === "crypto"
        ? "a single coin"
        : "a single company";
    const fund = (p: NextBuyPick) =>
      candidates.find((c) => c.key === p.key)?.incomeHeavy
        ? "a fund of many bonds"
        : "a fund of many companies";
    picks.forEach((p, i) => {
      // A lower pick whose dip speaks still has to say why it ranks lower
      // ("NVDA is 9% below its 1-year high." under VOO read as a non-answer, mission 64).
      if (i > 0 && p.target === null && p.reason.includes("below its 1-year high")) {
        const after = `${pctOf(p.weightAfter)} of your portfolio after this buy`;
        if (p.singleName && !top.singleName)
          p.reason = `${p.reason.slice(0, -1)}, but it's ${one(p)} that would be ${after}, so ${top.key}, ${fund(top)}, spreads your money more.`;
        else if (p.weightAfter > top.weightAfter)
          p.reason = `${p.reason.slice(0, -1)}, but it would be ${after}, so ${top.key} spreads your money more.`;
        return;
      }
      if (!p.reason.includes("; this buy takes it to")) return;
      const share = `${p.key} is ${pctOf(p.weightNow)} of your portfolio (${pctOf(p.weightAfter)} after this buy)`;
      if (i === 0) {
        p.reason =
          !p.singleName && second.singleName
            ? `${p.key} is ${fund(p)}, so it keeps your money more spread out than ${second.key}, ${one(second)} that would be ${pctOf(second.weightAfter)} of your portfolio after this buy.`
            : `${share}, so it keeps your money more spread out than ${second.key} would.`;
      } else {
        p.reason =
          p.singleName && !top.singleName
            ? `${p.key} is ${one(p)}, and this buy would make it ${pctOf(p.weightAfter)} of your portfolio, so it spreads your money less than ${top.key}, ${fund(top)}.`
            : `${share}, so it spreads your money less than ${top.key}.`;
      }
    });
  }
  if (top) compareShortfalls(picks, amountUsd);
  return picks;
}

const shortOf = (p: NextBuyPick) =>
  `${p.key} is ${usd(p.gapUsd ?? 0)} short of its ${pctOf(p.target ?? 0)} target`;

/**
 * "$941 short of its 20% target" alone read as a reason to buy BND next to
 * VTI, $3,117 short, and sat beside "27.5% after" as if the numbers disagreed
 * (minerva, mission 48). Among the options whose target speaks, say how each
 * shortfall compares with the biggest, and tell the top pick when the whole
 * amount carries it past its target.
 */
function compareShortfalls(picks: NextBuyPick[], amountUsd: number) {
  const short = picks.filter((p) => p.target !== null && p.reason === `${shortOf(p)}.`);
  if (short.length === 0) return;
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const bestFit = Math.max(...short.map((p) => p.fit));
  const best = short.find((p) => same(p.fit, bestFit))!;
  const top = picks[0]!;
  const offHigh = (p: NextBuyPick) =>
    p.offHigh !== null && p.offHigh <= -0.01 ? `, and it sits ${pct(p.offHigh)} below its 1-year high` : "";

  for (const p of short) {
    const base = shortOf(p);
    if (p === top) {
      const overshoot =
        (p.gapUsd ?? 0) < amountUsd - 0.5
          ? `; all ${usd(amountUsd)} here takes it to ${pctOf(p.weightAfter)}`
          : "";
      const tied = short.find((o) => o !== p && same(o.fit, p.fit));
      if (!same(p.fit, bestFit)) {
        // A near-tie the dip settled.
        p.reason = `${base}, close to ${best.key}'s ${usd(best.gapUsd ?? 0)}${offHigh(p)}.`;
      } else if (tied) {
        p.reason =
          p.fit === 1
            ? `${base}, so it can take all ${usd(amountUsd)}, like ${tied.key}${offHigh(p)}.`
            : `${base}, as much as ${tied.key}${offHigh(p)}.`;
      } else if (short.length > 1) {
        p.reason = `${base}, the most of your options${overshoot}.`;
      } else {
        p.reason = `${base}${overshoot}.`;
      }
    } else if (!same(p.fit, bestFit)) {
      p.reason = `${base}, less than ${best.key}'s ${usd(best.gapUsd ?? 0)}.`;
    } else {
      p.reason =
        top.dip > p.dip
          ? `${base}${same(p.fit, top.fit) ? " too" : ""}, but ${top.key} sits lower in its 1-year range.`
          : `${base}, the same as ${top.key}.`;
    }
  }
}

/** The larger weighted part of the score speaks. */
function reasonFor(
  p: NextBuyPick,
  c: NextBuyCandidate,
  weights: { fit: number; dip: number },
): string {
  const dipLeads = weights.dip * p.dip > weights.fit * p.fit;
  if (dipLeads && p.offHigh !== null && p.offHigh <= -DIP_REASON_MIN) {
    const underCost =
      p.vsCost !== null && p.vsCost <= -0.01 ? `, and ${pct(p.vsCost)} under what you paid` : "";
    return `${p.key} is ${pct(p.offHigh)} below its 1-year high${underCost}.`;
  }
  if (p.target !== null && p.gapUsd !== null) {
    if (p.target === 0) return `${p.key} isn't in your target mix.`;
    if (p.gapUsd > 0.5) return `${shortOf(p)}.`;
    return `${p.key} is already at or above its ${pctOf(p.target)} target.`;
  }
  if (c.heldValue <= 0) return `You don't own ${p.key} yet, so it spreads your money wider.`;
  if (p.weightNow < SMALL_WEIGHT)
    return `${p.key} is just ${pctOf(p.weightNow)} of your portfolio, so this spreads your money (${pctOf(p.weightAfter)} after).`;
  return `${p.key} is already ${pctOf(p.weightNow)} of your portfolio; this buy takes it to ${pctOf(p.weightAfter)}.`;
}

/** Order tax-advantaged accounts are offered in for interest-heavy funds. */
const SHELTER_ORDER: NextBuyAccountType[] = [
  "traditional_ira",
  "401k",
  "other_tax_advantaged",
  "roth_ira",
];

/**
 * Which account the buy belongs in, by three rules of thumb: crypto goes to a
 * taxable account; bond-like funds go to a tax-advantaged one (their interest
 * is taxed every year otherwise); everything else joins the account that
 * already holds it, else the first taxable account. A single account needs
 * no reason.
 */
export function placeAccount(
  c: Pick<NextBuyCandidate, "assetClass" | "incomeHeavy" | "heldIn">,
  accounts: NextBuyAccount[],
): NextBuyPick["account"] {
  if (accounts.length === 0) return null;
  const held = (c.heldIn ?? [])
    .map((id) => accounts.find((a) => a.id === id))
    .filter((a): a is NextBuyAccount => a !== undefined);
  const out = (a: NextBuyAccount, why: string | null) => ({
    id: a.id,
    name: a.name,
    why: accounts.length === 1 ? null : why,
  });
  const taxable = accounts.filter((a) => a.type === "taxable");

  if (c.assetClass === "crypto") {
    const a = held.find((h) => h.type === "taxable") ?? taxable[0];
    if (a) return out(a, held.includes(a) ? "where you already hold it" : null);
  }
  if (c.incomeHeavy) {
    const sheltered = (h: NextBuyAccount) => h.type !== "taxable";
    const a =
      held.find(sheltered) ??
      SHELTER_ORDER.map((t) => accounts.find((x) => x.type === t)).find(
        (x): x is NextBuyAccount => x !== undefined,
      );
    if (a) return out(a, "its interest would be taxed every year in a regular account");
  }
  if (held[0]) return out(held[0], "where you already hold it");
  return out(taxable[0] ?? accounts[0]!, null);
}
