/**
 * Re-importing an overlapping export (two halves of a history, a fresh full export after an
 * old one) must not double-count trades. A row is "already there" when the account already has
 * a transaction for the same asset and type, with the same quantity, price and fees, traded
 * within a minute of it. Matching is one-to-one: two identical fills in the file against one
 * existing row keep one of them, since real fills can repeat.
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

/** Equal to ~1e-9 relative: DB numerics come back padded ("32.710000000000000000"). */
const same = (a: string | null, b: string | null) => {
  if (a === null || b === null) return a === b;
  const x = Number(a);
  const y = Number(b);
  return Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
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
          Math.abs(c.row.tradedAt.getTime() - r.tradedAt.getTime()) <= WINDOW_MS &&
          same(c.row.quantity, r.quantity) &&
          same(c.row.pricePerUnit, r.pricePerUnit) &&
          same(c.row.fees, r.fees),
      );
    if (match) {
      match.used = true;
      duplicates.push(r);
    } else fresh.push(r);
  }
  return { fresh, duplicates };
}
