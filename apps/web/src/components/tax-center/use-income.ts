"use client";

import type { FilingStatus } from "@beobeo/core/tax-brackets";
import { useEffect, useMemo } from "react";
import { usePortfolio } from "@/components/portfolio-context";
import { setIncomeCookie } from "@/lib/income-cookie";
import { useStoredState } from "@/lib/use-stored-state";

export interface StoredIncome {
  status: FilingStatus | null;
  /** Taxable income this year (after deductions), before investment gains. */
  taxableIncomeUsd: number | null;
  /** The pay it was worked out from (pay minus the standard deduction), when
   *  pay was typed in setup or Tax Profile. Absent when taxable income was
   *  typed directly, a band was tapped, or for incomes saved before 2026-10-30. */
  payUsd?: number | null;
  /** The taxable-income band tapped in setup instead of typing pay (its
   *  lower edge, under that filing status), so Tax Profile can say which
   *  band set the rates. Absent when pay was typed or setup was skipped. */
  band?: { status: FilingStatus; incomeFrom: number } | null;
}

const EMPTY: StoredIncome = { status: null, taxableIncomeUsd: null };

/** Device key; welcome step 1 writes the status through it before the app shell mounts. */
export const incomeKey = (userId: string) => `beobeo.tax.income.${userId}`;

/**
 * How you file and roughly what you earn, saved on this device per user, like
 * the target mix: storing them on the server needs a new column and a
 * human-run `db:push`. Welcome step 1 saves the status; Tax Profile → Your
 * income takes the number. Together (`complete`, a stable reference while
 * unchanged) they size the 0% long-term gain room on the Now tab (R-003).
 * The chat can't see them. A cookie mirrors the complete pair so the Tax
 * Center's layout can warm `tax.now` with it (`lib/income-cookie.ts`).
 */
export function useIncome() {
  const { userId } = usePortfolio();
  const [income, setIncome] = useStoredState<StoredIncome>(incomeKey(userId), EMPTY);
  const complete = useMemo(
    () =>
      income.status && income.taxableIncomeUsd !== null
        ? { status: income.status, taxableIncomeUsd: income.taxableIncomeUsd }
        : undefined,
    [income],
  );
  useEffect(() => setIncomeCookie(userId, complete), [userId, complete]);
  return { income, setIncome, complete };
}
