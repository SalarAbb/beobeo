/**
 * Rough federal bracket picker for sign-up (R-005): a filing status and an
 * income band turn into the two rates the tax profile needs, so a new user
 * never has to know what "LTCG rate" means. Plain numbers, client-safe
 * (subpath export `@beobeo/core/tax-brackets`).
 *
 * Figures are the 2026 federal thresholds on *taxable* income (after the
 * standard deduction), IRS Rev. Proc. 2025-32. Re-check them every November.
 */

export type FilingStatus = "single" | "married_joint" | "head_of_household";

export const FILING_STATUS_LABEL: Record<FilingStatus, string> = {
  single: "Single",
  married_joint: "Married, filing jointly",
  head_of_household: "Head of household",
};

/** Upper bound of each ordinary rate (the last rate has no bound). */
const ORDINARY: Record<FilingStatus, { ratePct: number; upTo: number | null }[]> = {
  single: [
    { ratePct: 10, upTo: 12_400 },
    { ratePct: 12, upTo: 50_400 },
    { ratePct: 22, upTo: 105_700 },
    { ratePct: 24, upTo: 201_775 },
    { ratePct: 32, upTo: 256_225 },
    { ratePct: 35, upTo: 640_600 },
    { ratePct: 37, upTo: null },
  ],
  married_joint: [
    { ratePct: 10, upTo: 24_800 },
    { ratePct: 12, upTo: 100_800 },
    { ratePct: 22, upTo: 211_400 },
    { ratePct: 24, upTo: 403_550 },
    { ratePct: 32, upTo: 512_450 },
    { ratePct: 35, upTo: 768_700 },
    { ratePct: 37, upTo: null },
  ],
  head_of_household: [
    { ratePct: 10, upTo: 17_700 },
    { ratePct: 12, upTo: 67_450 },
    { ratePct: 22, upTo: 105_700 },
    { ratePct: 24, upTo: 201_750 },
    { ratePct: 32, upTo: 256_200 },
    { ratePct: 35, upTo: 640_600 },
    { ratePct: 37, upTo: null },
  ],
};

/** Long-term gains: 0% up to the first bound, 15% up to the second, then 20%. */
const LTCG: Record<FilingStatus, { zeroUpTo: number; fifteenUpTo: number }> = {
  single: { zeroUpTo: 49_450, fifteenUpTo: 545_500 },
  married_joint: { zeroUpTo: 98_900, fifteenUpTo: 613_700 },
  head_of_household: { zeroUpTo: 66_200, fifteenUpTo: 579_600 },
};

/** Long-term gain rate on the next dollar above `taxableIncome`. */
export function ltcgRateAt(status: FilingStatus, taxableIncome: number): number {
  const t = LTCG[status];
  if (taxableIncome < t.zeroUpTo) return 0;
  if (taxableIncome < t.fifteenUpTo) return 15;
  return 20;
}

export interface BracketOption {
  /** Ordinary rate on the band's income (short-term gains are taxed at it). */
  ordinaryRatePct: number;
  /** Long-term gain rate where the band starts. */
  ltcgRatePct: number;
  incomeFrom: number;
  /** null = no upper bound. */
  incomeTo: number | null;
}

/**
 * The bands a user picks from, lowest first. The 10% band is folded into
 * 12% (it's a sliver, and nobody knows which side of $12,400 they're on).
 * Each band's long-term rate is the one at its lower edge, which is where
 * most of the band sits: e.g. single 12% (to $50,400) → 0%, because the 0%
 * gain bracket runs to $49,450.
 */
export function bracketOptions(status: FilingStatus): BracketOption[] {
  const rows = ORDINARY[status];
  const out: BracketOption[] = [];
  let from = 0;
  for (const [i, row] of rows.entries()) {
    if (i === 0) continue; // folded into the next band
    out.push({
      ordinaryRatePct: row.ratePct,
      ltcgRatePct: ltcgRateAt(status, from),
      incomeFrom: from,
      incomeTo: row.upTo,
    });
    from = row.upTo ?? from;
  }
  return out;
}
