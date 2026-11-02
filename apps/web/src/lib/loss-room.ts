/**
 * Where the year stands against the $3,000 a net capital loss may take off
 * pay, from the same netting as core `explainNetting` (cross-net the
 * short- and long-term buckets, past-year carryforwards included), in plain
 * numbers so it can run as the Tax Profile's fields are typed. Petyr
 * (missions 110, 114, 119): "Nowhere does it tell me how much of the $3,000
 * deduction cap I've used."
 */
export const LOSS_DEDUCTION_CAP = 3000;

export type LossRoom = {
  /** Gain left after netting, which a new loss cancels before any of the $3,000. */
  netGainUsd: number;
  /** Net loss after netting (0 when the year nets to a gain). */
  netLossUsd: number;
  /** Of the $3,000, what the net loss already takes. */
  usedUsd: number;
  leftUsd: number;
  /** Net loss past the $3,000, carried to next year. */
  carriesUsd: number;
  /** Past-year losses are part of the figure. */
  hasCarryforward: boolean;
};

export function lossRoom({
  ytdShortTerm,
  ytdLongTerm,
  carryShortTerm = 0,
  carryLongTerm = 0,
}: {
  ytdShortTerm: number;
  ytdLongTerm: number;
  carryShortTerm?: number;
  carryLongTerm?: number;
}): LossRoom {
  let st = ytdShortTerm - carryShortTerm;
  let lt = ytdLongTerm - carryLongTerm;
  if (st < 0 && lt > 0) {
    const off = Math.min(-st, lt);
    st += off;
    lt -= off;
  } else if (lt < 0 && st > 0) {
    const off = Math.min(-lt, st);
    lt += off;
    st -= off;
  }
  const cents = (v: number) => Math.round(v * 100) / 100;
  const netGainUsd = cents(Math.max(0, st) + Math.max(0, lt));
  const netLossUsd = cents(Math.max(0, -st) + Math.max(0, -lt));
  const usedUsd = Math.min(netLossUsd, LOSS_DEDUCTION_CAP);
  return {
    netGainUsd,
    netLossUsd,
    usedUsd,
    leftUsd: cents(LOSS_DEDUCTION_CAP - usedUsd),
    carriesUsd: cents(netLossUsd - usedUsd),
    hasCarryforward: carryShortTerm > 0 || carryLongTerm > 0,
  };
}
