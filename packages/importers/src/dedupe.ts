/**
 * Re-importing an overlapping export (two halves of a history, a fresh full export after an
 * old one) must not double-count trades. A row is "already there" when the account already has
 * a transaction for the same asset and type, with the same quantity, price and fees, traded
 * within a minute of it — or within 36 hours when the price also matches, because many broker
 * exports carry only a date (read as midnight) while the same trade was stored with its time
 * (found by a persona mission: an overlapping Robinhood export imported every trade twice).
 * Prices compare to the cent (exports round them). Matching is one-to-one: two identical fills in
 * the file against one existing row keep one of them, since real fills can repeat.
 *
 * Pure and framework-free; the server runs it inside `transactions.bulkCreate`.
 */
export interface DedupeRow {
  accountId: string;
  assetId: string;
  type: string;
  quantity: string;
  pricePerUnit: string | null;
  fees: string;
  tradedAt: Date;
}

const WINDOW_MS = 60_000;
/** Same calendar trade seen from two time zones / a date-only export. Quantity AND price must match too. */
const DATE_ONLY_WINDOW_MS = 36 * 3_600_000;

/** Equal to ~1e-9 relative: DB numerics come back padded ("32.710000000000000000"). */
const same = (a: string | null, b: string | null) => {
  if (a === null || b === null) return a === b;
  const x = Number(a);
  const y = Number(b);
  return Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
};

/** Exports round prices to the cent: equal within half a cent or 0.05%. */
const samePrice = (a: string | null, b: string | null) => {
  if (a === null || b === null) return a === b;
  const x = Number(a);
  const y = Number(b);
  return Math.abs(x - y) <= Math.max(0.005, 5e-4 * Math.max(Math.abs(x), Math.abs(y)));
};

const key = (r: DedupeRow) => `${r.accountId}|${r.assetId}|${r.type}`;

export function splitDuplicates<T extends DedupeRow>(incoming: T[], existing: DedupeRow[]): { fresh: T[]; duplicates: T[] } {
  const pool = new Map<string, { row: DedupeRow; used: boolean }[]>();
  for (const e of existing) {
    const list = pool.get(key(e)) ?? [];
    list.push({ row: e, used: false });
    pool.set(key(e), list);
  }
  const fresh: T[] = [];
  const duplicates: T[] = [];
  for (const r of incoming) {
    const match = pool
      .get(key(r))
      ?.find(
        (c) =>
          !c.used &&
          same(c.row.quantity, r.quantity) &&
          samePrice(c.row.pricePerUnit, r.pricePerUnit) &&
          samePrice(c.row.fees, r.fees) &&
          Math.abs(c.row.tradedAt.getTime() - r.tradedAt.getTime()) <=
            (c.row.pricePerUnit !== null && r.pricePerUnit !== null ? DATE_ONLY_WINDOW_MS : WINDOW_MS),
      );
    if (match) {
      match.used = true;
      duplicates.push(r);
    } else fresh.push(r);
  }
  return { fresh, duplicates };
}
