/**
 * Raise Cash's inputs, kept on the device (`useStoredState`): the Tax Center
 * tab reads them, and the dashboard's "Taking money out" section writes the
 * usual withdrawal into them before opening the tab.
 */
export const RAISE_CASH_KEY = "beobeo.tax.raise";

export type RaiseCashState = {
  amountInput: string;
  target: number | null;
  doNotSell: string[];
  /** Sell only from this taxable account; unset = any of them. */
  accountId?: string;
};

export const RAISE_CASH_DEFAULT: RaiseCashState = {
  amountInput: "10000",
  target: 10000,
  doNotSell: [],
};
