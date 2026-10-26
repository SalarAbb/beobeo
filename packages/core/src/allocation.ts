/**
 * Target-mix tools: how far a portfolio sits from its target weights, and
 * where new money should go to close the gap without selling anything.
 *
 * Plain numbers, like metrics.ts: values arrive from the overview payload
 * (already Decimal→number at the edge) and the output is a suggestion the
 * user types into a buy, rounded to cents.
 */

export interface AllocationHolding {
  key: string;
  value: number;
}

/** Target weights as fractions (0.5 = 50%), keyed like the holdings. */
export type TargetMix = Record<string, number>;

export interface DriftRow {
  key: string;
  value: number;
  /** Current weight, fraction of the total. */
  current: number;
  /** Target weight, fraction (0 for an untargeted holding). */
  target: number;
  /** current − target: positive = overweight. */
  drift: number;
  /** target × total − value: positive = dollars short of target. */
  gapUsd: number;
}

/**
 * One row per asset that is held or targeted. Ordered by target weight
 * (the user's own plan order), then by value.
 */
export function allocationDrift(
  holdings: AllocationHolding[],
  targets: TargetMix,
): { total: number; rows: DriftRow[] } {
  const values = new Map<string, number>();
  for (const h of holdings) values.set(h.key, (values.get(h.key) ?? 0) + h.value);
  for (const key of Object.keys(targets)) if (!values.has(key)) values.set(key, 0);

  const total = holdings.reduce((s, h) => s + h.value, 0);
  const rows = [...values].map(([key, value]): DriftRow => {
    const current = total > 0 ? value / total : 0;
    const target = targets[key] ?? 0;
    return { key, value, current, target, drift: current - target, gapUsd: target * total - value };
  });
  rows.sort((a, b) => b.target - a.target || b.value - a.value || a.key.localeCompare(b.key));
  return { total, rows };
}

/**
 * Split a deposit across targeted assets so the portfolio moves as close to
 * the target mix as buying alone allows ("water-filling"): the most
 * underweight sleeve is topped up first; once it catches up to the next one
 * (measured as value ÷ target weight), both are filled together, and so on.
 * Overweight and untargeted assets never receive money. A deposit large
 * enough to reach the target exactly lands every sleeve on target, and the
 * rest follows the weights.
 *
 * Amounts are rounded to cents with the largest-remainder method, so they
 * always add up to the deposit. Ordered by amount, largest first.
 */
export function fillToTarget(
  holdings: AllocationHolding[],
  targets: TargetMix,
  amountUsd: number,
): { key: string; amountUsd: number }[] {
  const totalCents = Math.round(amountUsd * 100);
  const pool = Object.entries(targets)
    .filter(([, w]) => w > 0)
    .map(([key, w]) => ({
      key,
      w,
      v: holdings.filter((h) => h.key === key).reduce((s, h) => s + h.value, 0),
    }));
  if (totalCents <= 0 || pool.length === 0) return [];

  // Ascending by value per unit of target weight: the most underweight first.
  pool.sort((a, b) => a.v / a.w - b.v / b.w || a.key.localeCompare(b.key));
  let level = 0;
  let k = 0;
  let wSum = 0;
  let vSum = 0;
  while (k < pool.length) {
    wSum += pool[k]!.w;
    vSum += pool[k]!.v;
    k++;
    level = (amountUsd + vSum) / wSum;
    const next = pool[k];
    if (!next || level <= next.v / next.w) break;
  }

  const raw = pool
    .slice(0, k)
    .map((p) => ({ key: p.key, amount: Math.max(0, p.w * level - p.v) }));
  const rawSum = raw.reduce((s, r) => s + r.amount, 0);
  if (rawSum <= 0) return [];

  // Largest remainder: floor every share in cents, hand out the leftover
  // cents to the biggest fractional parts (ties alphabetical).
  const shares = raw.map((r) => {
    const exact = (r.amount / rawSum) * totalCents;
    return { key: r.key, cents: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let left = totalCents - shares.reduce((s, x) => s + x.cents, 0);
  for (const s of [...shares].sort((a, b) => b.frac - a.frac || a.key.localeCompare(b.key))) {
    if (left <= 0) break;
    s.cents++;
    left--;
  }

  return shares
    .filter((s) => s.cents > 0)
    .sort((a, b) => b.cents - a.cents || a.key.localeCompare(b.key))
    .map((s) => ({ key: s.key, amountUsd: s.cents / 100 }));
}
