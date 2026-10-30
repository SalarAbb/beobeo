import type { FilingStatus } from "@beobeo/core/tax-brackets";

/**
 * Cookie mirror of the device's saved income (the income itself lives in
 * localStorage, see `tax-center/use-income.ts`), like `portfolio-cookie.ts`.
 * The Tax Center's layout reads it only to warm `tax.now` with the same
 * input the page will send, so that query joins the warm-up instead of
 * starting cold (~390ms → ~80ms). The value carries the user id, so another
 * user signed in on this device never warms with it; nothing is computed
 * from it that the page doesn't ask for again.
 */
export const INCOME_COOKIE = "beobeo.income";

const STATUSES: FilingStatus[] = ["single", "married_joint", "head_of_household"];

type Income = { status: FilingStatus; taxableIncomeUsd: number };

export function setIncomeCookie(userId: string, income: Income | undefined): void {
  document.cookie = income
    ? `${INCOME_COOKIE}=${encodeURIComponent(`${userId}|${income.status}|${income.taxableIncomeUsd}`)}; path=/; max-age=31536000; samesite=lax`
    : `${INCOME_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

export function parseIncomeCookie(value: string | undefined, userId: string): Income | undefined {
  if (!value) return undefined;
  const [owner, status, amount] = decodeURIComponent(value).split("|");
  const taxableIncomeUsd = Number(amount);
  if (owner !== userId || !STATUSES.includes(status as FilingStatus)) return undefined;
  if (!Number.isFinite(taxableIncomeUsd) || taxableIncomeUsd < 0 || taxableIncomeUsd > 100_000_000) {
    return undefined;
  }
  return { status: status as FilingStatus, taxableIncomeUsd };
}
