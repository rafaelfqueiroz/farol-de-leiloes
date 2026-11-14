// AR-17..AR-19: money is never a JS `number`. In code it is a `Decimal` from this module — a
// decimal.js constructor configured once, so every amount in the backend rounds the same way.
// The named export, not the default: decimal.js ships one CommonJS-flavoured .d.ts for both its
// builds, so under NodeNext resolution the default import types as the module object (#63).
import { Decimal as DecimalJs } from 'decimal.js';

/**
 * The backend's Decimal: 34 significant digits, the most a MongoDB Decimal128 holds, so an
 * amount survives the round trip to the database unchanged; ROUND_HALF_EVEN, the AR-19 default;
 * and no exponent notation in `toString()` for any amount a person could hold.
 *
 * Clones of decimal.js share one prototype, so `instanceof Decimal` holds for any decimal.js
 * instance. Test untrusted input with `instanceof`, not `Decimal.isDecimal`: isDecimal also
 * accepts a plain object with `toStringTag: "[object Decimal]"`, which a JSON body can forge.
 */
export const Decimal = DecimalJs.clone({
  precision: 34,
  rounding: DecimalJs.ROUND_HALF_EVEN,
  toExpNeg: -34,
  toExpPos: 34,
});
export type Decimal = DecimalJs;

/** AR-19: money leaves a calculation with two decimal places. */
export const MONEY_DECIMAL_PLACES = 2;

/**
 * What the API accepts as an amount of reais (AR-17): a non-negative decimal string with a dot
 * and at most two decimal places — `"1234.56"`, `"300000"`, `"0.1"`. No thousands separator, no
 * sign, no exponent, no `R$`: formatting is the frontend's (AR-21). Fifteen integer digits is
 * far above any price and far below where Decimal128's 34 digits run out.
 */
export const MONEY_PATTERN = '^\\d{1,15}(\\.\\d{1,2})?$';
const MONEY_REGEX = new RegExp(MONEY_PATTERN);

export function isMoneyString(value: unknown): value is string {
  return typeof value === 'string' && MONEY_REGEX.test(value);
}

/** Parses an API amount (MONEY_PATTERN). Anything else is a programming error, not a value. */
export function parseMoney(value: string): Decimal {
  if (!isMoneyString(value)) {
    throw new TypeError('Not a money string (MONEY_PATTERN)');
  }
  return new Decimal(value);
}

/**
 * AR-19: the one place an amount is rounded — to two decimal places, half-even — on its way out
 * (JSON, a stored total). Intermediate values keep full precision; round only at the edge.
 *
 *   toMoneyString(new Decimal('2.345')) === '2.34'   // half-even: 4 is even
 *   toMoneyString(new Decimal('2.355')) === '2.36'   // half-even: 6 is even
 *   toMoneyString(new Decimal('1000'))  === '1000.00'
 */
export function toMoneyString(value: Decimal): string {
  return value.toFixed(MONEY_DECIMAL_PLACES, Decimal.ROUND_HALF_EVEN);
}
