/**
 * Raise Cash's inputs, kept on the device (`useStoredState`): the Tax Center
 * tab reads them, and the dashboard's "Taking money out" section writes the
 * usual withdrawal into them before opening the tab, and a holding's page
 * writes an amount and that holding (`only`).
 */
export const RAISE_CASH_KEY = "beobeo.tax.raise";

export type RaiseCashState = {
  amountInput: string;
  target: number | null;
  doNotSell: string[];
  /** Sell only from this taxable account; unset = any of them. */
  accountId?: string;
  /** Sell only this symbol (set from a holding's page); unset = anything. */
  only?: string;
};

/**
 * What the plan leaves alone, given the symbols this portfolio holds (sorted,
 * so the tab and the Tax Center's warm-up send the same query). `only` counts
 * when it's held here; elsewhere it's ignored, not a plan selling nothing.
 */
export function raiseCashDoNotSell(state: RaiseCashState, symbols: string[]): string[] {
  return state.only && symbols.includes(state.only)
    ? symbols.filter((s) => s !== state.only)
    : state.doNotSell;
}

export const RAISE_CASH_DEFAULT: RaiseCashState = {
  amountInput: "10000",
  target: 10000,
  doNotSell: [],
};
