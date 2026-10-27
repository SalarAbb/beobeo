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
 *   dip — how far it sits below its own trailing-year range (70%) and below
 *         what you paid for it (30%, full marks at 20% under your cost).
 * score = 0.6 × fit + 0.4 × dip. Ties go to the lower weight after the buy,
 * then the symbol, so the same inputs always give the same pick.
 *
 * Plain numbers, like allocation.ts: values arrive Decimal→number from the
 * overview payload, and the output is a suggestion, not a ledger entry.
 */

import type { TargetMix } from "./allocation";

export const NEXT_BUY_WEIGHTS = { fit: 0.6, dip: 0.4 } as const;
/** Inside the dip score: position in the 1-year range vs. under your cost. */
const RANGE_SHARE = 0.7;
/** Being this far under your average cost earns the full cost part. */
const FULL_COST_DIP = 0.2;
/** A dip reason needs at least this much off the 1-year high. */
const DIP_REASON_MIN = 0.05;
/** Under this weight a holding reads as small ("just 6% of your portfolio"). */
const SMALL_WEIGHT = 0.25;

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

  const picks = candidates.map((c): NextBuyPick => {
    const weightNow = portfolioValue > 0 ? c.heldValue / portfolioValue : 0;
    const weightAfter = (c.heldValue + amountUsd) / totalAfter;

    let target: number | null = null;
    let gapUsd: number | null = null;
    let fit: number;
    if (targets) {
      target = targets[c.key] ?? 0;
      gapUsd = target * totalAfter - c.heldValue;
      fit = target > 0 ? clamp01(gapUsd / amountUsd) : 0;
    } else {
      fit = 1 - weightAfter;
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

    const score = NEXT_BUY_WEIGHTS.fit * fit + NEXT_BUY_WEIGHTS.dip * dip;
    const pick: NextBuyPick = {
      key: c.key,
      score,
      fit,
      dip,
      weightNow,
      weightAfter,
      target,
      gapUsd,
      offHigh,
      rangePosition,
      vsCost,
      reason: "",
      account: placeAccount(c, input.accounts ?? []),
    };
    pick.reason = reasonFor(pick, c);
    return pick;
  });

  picks.sort(
    (a, b) =>
      b.score - a.score || a.weightAfter - b.weightAfter || a.key.localeCompare(b.key),
  );
  // "Already 67% of your portfolio" alone reads as a reason against a pick;
  // with other options, compare: the top pick spreads money more than the
  // runner-up, every other pick less than the top.
  const [top, second] = picks;
  if (top && second) {
    picks.forEach((p, i) => {
      if (!p.reason.includes("; this buy takes it to")) return;
      const share = `${p.key} is ${pctOf(p.weightNow)} of your portfolio (${pctOf(p.weightAfter)} after this buy)`;
      p.reason =
        i === 0
          ? `${share}, so it keeps your money more spread out than ${second.key} would.`
          : `${share}, so it spreads your money less than ${top.key}.`;
    });
  }
  return picks;
}

/** The larger weighted part of the score speaks. */
function reasonFor(p: NextBuyPick, c: NextBuyCandidate): string {
  const dipLeads = NEXT_BUY_WEIGHTS.dip * p.dip > NEXT_BUY_WEIGHTS.fit * p.fit;
  if (dipLeads && p.offHigh !== null && p.offHigh <= -DIP_REASON_MIN) {
    const underCost =
      p.vsCost !== null && p.vsCost <= -0.01 ? `, and ${pct(p.vsCost)} under what you paid` : "";
    return `${p.key} is ${pct(p.offHigh)} below its 1-year high${underCost}.`;
  }
  if (p.target !== null && p.gapUsd !== null) {
    if (p.target === 0) return `${p.key} isn't in your target mix.`;
    if (p.gapUsd > 0.5)
      return `${p.key} is ${usd(p.gapUsd)} short of its ${pctOf(p.target)} target.`;
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
