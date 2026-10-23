import { D, Decimal, ZERO } from "./types";

/**
 * Combined (federal + state) effective rates used to value a lot's tax
 * cost. Rates are fractions (0.32 = 32%), not percentages — callers fold
 * state add-ons in before calling.
 */
export interface TaxRates {
  /** Applies to short-term gains and to the $3,000 ordinary-income offset. */
  ordinaryRate: number;
  /** Applies to long-term gains. */
  ltcgRate: number;
  /** Value multiplier (0..1) applied to loss that only becomes a carryforward
   *  (not usable this year) — it's real money, just deferred and uncertain. */
  carryforwardDiscount: number;
}

/** The federal annual cap on net capital loss deductible against ordinary income. */
const ORDINARY_LOSS_CAP = D(3000);

/** Where a year's net short-term/long-term position ends up, bucket by
 *  bucket — the same breakdown `totalTax` computes internally, exposed so
 *  callers can show *why* a number is what it is (e.g. "this offsets your
 *  gains" vs "this only carries forward"). Every field is ≥ 0. */
export interface NettingBreakdown {
  /** Net short-term gain still taxed after cross-netting (0 if none/a loss). */
  shortTermGainTaxed: Decimal;
  /** Net long-term gain still taxed after cross-netting (0 if none/a loss). */
  longTermGainTaxed: Decimal;
  /** Remaining net loss applied against ordinary income (≤ $3,000). */
  ordinaryDeduction: Decimal;
  /** Remaining net loss beyond the $3,000 cap — carries forward. */
  carryforward: Decimal;
  totalTax: Decimal;
}

/**
 * Where a year's net short-term and net long-term capital gain/loss
 * positions end up, under simplified federal netting rules:
 *
 *  1. Cross-netting: if one bucket is a net gain and the other a net loss,
 *     the loss offsets the gain first (dollar-for-dollar) before anything
 *     else happens.
 *  2. Whatever gain remains is taxed at its own rate (short-term at
 *     `ordinaryRate`, long-term at `ltcgRate`).
 *  3. Whatever net loss remains (after cross-netting) offsets up to $3,000
 *     of ordinary income, valued at `ordinaryRate`.
 *  4. Any loss beyond that is a carryforward — real value, but deferred and
 *     uncertain, so it's valued at `ordinaryRate * carryforwardDiscount`.
 *
 * This is intentionally a numerical function, not a per-dollar rate table:
 * callers value a lot by computing `totalTax(state+lot) - totalTax(state)`,
 * which lets a single lot's marginal value correctly cross the $3,000
 * boundary or a cross-netting boundary without special-casing — the
 * boundary falls out of two function calls, not a formula. A simplification
 * of real capital-loss-carryover law (documented deliberately); the UI must
 * carry a "not tax advice, estimate only" disclaimer.
 */
export function explainNetting(
  shortTermNet: Decimal,
  longTermNet: Decimal,
  rates: TaxRates,
): NettingBreakdown {
  let st = shortTermNet;
  let lt = longTermNet;

  // 1. Cross-netting between opposite-signed buckets.
  if (st.isNeg() && lt.isPos()) {
    const offset = Decimal.min(st.neg(), lt);
    st = st.add(offset);
    lt = lt.sub(offset);
  } else if (lt.isNeg() && st.isPos()) {
    const offset = Decimal.min(lt.neg(), st);
    lt = lt.add(offset);
    st = st.sub(offset);
  }

  let tax = ZERO;

  // 2. Remaining gains, taxed at their own rate.
  const shortTermGainTaxed = st.isPos() ? st : ZERO;
  const longTermGainTaxed = lt.isPos() ? lt : ZERO;
  tax = tax.add(shortTermGainTaxed.mul(rates.ordinaryRate));
  tax = tax.add(longTermGainTaxed.mul(rates.ltcgRate));

  // 3–4. Remaining net loss: up to $3,000 against ordinary income, the
  // rest as a discounted carryforward.
  const netLoss = (st.isNeg() ? st.neg() : ZERO).add(lt.isNeg() ? lt.neg() : ZERO);
  let ordinaryDeduction = ZERO;
  let carryforward = ZERO;
  if (netLoss.isPos()) {
    ordinaryDeduction = Decimal.min(netLoss, ORDINARY_LOSS_CAP);
    tax = tax.sub(ordinaryDeduction.mul(rates.ordinaryRate));
    carryforward = netLoss.sub(ordinaryDeduction);
    if (carryforward.isPos()) {
      tax = tax.sub(carryforward.mul(rates.ordinaryRate).mul(rates.carryforwardDiscount));
    }
  }

  return { shortTermGainTaxed, longTermGainTaxed, ordinaryDeduction, carryforward, totalTax: tax };
}

/** Just the tax number — see `explainNetting` for the full breakdown and
 *  the netting rules this implements. */
export function totalTax(
  shortTermNet: Decimal,
  longTermNet: Decimal,
  rates: TaxRates,
): Decimal {
  return explainNetting(shortTermNet, longTermNet, rates).totalTax;
}
