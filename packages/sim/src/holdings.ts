/**
 * The persona's own mental ledger: average-cost positions per account. Used
 * to drive decisions (take-profit, harvest, rebalance) — NOT a substitute
 * for the app's FIFO engine. Discrepancies between what a persona "thinks"
 * it has and what the app shows are themselves useful feedback.
 */
export interface Position {
  qty: number;
  cost: number;
}

export interface Fill {
  type: "buy" | "sell";
  account: string;
  symbol: string;
  qty: number;
  price: number;
}

export class Holdings {
  private book = new Map<string, Map<string, Position>>();

  /**
   * @param dpOf decimal places the app stores for a symbol's quantity. Every
   * fill is rounded to it HERE, so the ledger is exactly the sum of the
   * strings sent to the app — a "sell everything" can never exceed the
   * rounded buys by 1e-6 (which the FIFO engine rightly rejects as OVERSELL).
   */
  constructor(private readonly dpOf: (symbol: string) => number = () => 6) {}

  private round(symbol: string, qty: number): number {
    const f = 10 ** this.dpOf(symbol);
    return Math.round(qty * f) / f;
  }

  get(account: string, symbol: string): Position | undefined {
    return this.book.get(account)?.get(symbol);
  }

  positions(account?: string): { account: string; symbol: string; pos: Position }[] {
    const out: { account: string; symbol: string; pos: Position }[] = [];
    for (const [acct, m] of this.book) {
      if (account && acct !== account) continue;
      for (const [symbol, pos] of m) if (pos.qty > 0) out.push({ account: acct, symbol, pos });
    }
    return out;
  }

  /**
   * Apply a fill. Sells clamp to the held quantity (a persona never
   * oversells — the engine would throw OVERSELL and the replay would stall).
   * Returns the fill actually applied, or null when there was nothing to sell.
   */
  apply(fill: Fill): Fill | null {
    let m = this.book.get(fill.account);
    if (!m) this.book.set(fill.account, (m = new Map()));
    const pos = m.get(fill.symbol) ?? { qty: 0, cost: 0 };
    const want = this.round(fill.symbol, fill.qty);
    if (fill.type === "buy") {
      if (want <= 0) return null;
      m.set(fill.symbol, { qty: this.round(fill.symbol, pos.qty + want), cost: pos.cost + want * fill.price });
      return { ...fill, qty: want };
    }
    const qty = Math.min(want, pos.qty);
    if (qty <= 0) return null;
    const avg = pos.qty > 0 ? pos.cost / pos.qty : 0;
    const left = this.round(fill.symbol, pos.qty - qty);
    m.set(fill.symbol, left <= 0 ? { qty: 0, cost: 0 } : { qty: left, cost: pos.cost - avg * qty });
    return { ...fill, qty };
  }

  marketValue(priceOf: (symbol: string) => number | null, account?: string): number {
    let v = 0;
    for (const { symbol, pos } of this.positions(account)) v += pos.qty * (priceOf(symbol) ?? 0);
    return v;
  }
}
