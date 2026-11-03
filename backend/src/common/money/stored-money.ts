// EXPAND (AR-28): remove in contract step, #34 PR 2.
//
// The tolerant readers of the expand step. Documents written before #34 hold money as a JS
// `number`; every writer now writes Decimal128. Until PR 2's migration (AR-29) rewrites the old
// documents, readers accept both shapes through these two functions and nowhere else. The
// contract step deletes this file and its callers read with `fromDecimal128` directly.
import { Types } from 'mongoose';
import { fromDecimal128, isDecimal128 } from './decimal128';
import { Decimal } from './money';

/**
 * EXPAND (AR-28): remove in contract step, #34 PR 2.
 * A money field as it may be stored during the expand step: Decimal128 (new) or number (legacy).
 */
export type StoredMoney = Types.Decimal128 | number;

/**
 * EXPAND (AR-28): remove in contract step, #34 PR 2.
 * A stored amount of reais in either shape, or null when absent. A legacy `number` is read
 * through its shortest round-trip string (`91589.89` → `"91589.89"`), which recovers the decimal
 * the importer meant to store; the value never takes part in arithmetic as a float.
 */
export function fromStoredMoney(value: unknown): Decimal | null {
  if (value === null || value === undefined) return null;
  if (isDecimal128(value)) return fromDecimal128(value);
  if (typeof value === 'number' && Number.isFinite(value)) return new Decimal(String(value));
  // A shape no writer ever produced: a fault (ARCHITECTURE §9), not a price to guess.
  throw new TypeError('Stored money is neither Decimal128 nor a legacy number');
}

/**
 * EXPAND (AR-28): remove in contract step, #34 PR 2.
 * A coupon's `discountValue`, converted in place by #34: legacy documents hold integer
 * **centavos** as a number; new ones hold **reais** as Decimal128. Answers reais either way.
 *
 *   fromStoredCouponDiscount(1000)                               → 10 (R$ 10,00)
 *   fromStoredCouponDiscount(Types.Decimal128.fromString('10'))  → 10
 */
export function fromStoredCouponDiscount(value: unknown): Decimal {
  if (isDecimal128(value)) return fromDecimal128(value);
  if (typeof value === 'number' && Number.isInteger(value)) return new Decimal(value).div(100);
  throw new TypeError('Stored coupon discount is neither Decimal128 nor legacy integer centavos');
}
