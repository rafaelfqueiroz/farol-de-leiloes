// AR-17: in MongoDB money is a Decimal128; in code a Decimal. These two functions are the only
// crossing between them, so no amount passes through a JS `number` on the way in or out.
import { Types } from 'mongoose';
import { Decimal } from './money.js';

/**
 * Decimal → Decimal128 at full precision: `toFixed()` without arguments writes every digit in
 * plain notation, and Decimal's 34-digit precision is Decimal128's, so nothing is rounded here
 * (AR-19 rounds at the edge, not on save).
 */
export function toDecimal128(value: Decimal): Types.Decimal128 {
  return Types.Decimal128.fromString(value.toFixed());
}

/** As toDecimal128, keeping an absent amount absent. */
export function toDecimal128OrNull(value: Decimal | null | undefined): Types.Decimal128 | null {
  return value === null || value === undefined ? null : toDecimal128(value);
}

/**
 * A BSON Decimal128 as read from the driver (lean) or a hydrated document. Checked by its BSON
 * type tag rather than `instanceof`, so a Decimal128 from another copy of `bson` is recognised.
 */
export function isDecimal128(value: unknown): value is Types.Decimal128 {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { _bsontype?: unknown })._bsontype === 'Decimal128'
  );
}

/**
 * Decimal128 → Decimal, digit for digit: the string form is parsed, never a float.
 *
 * Anything else is a fault, not a price to guess (ARCHITECTURE §9): since #34's migration
 * (`migrations/0001-money-decimal128.ts`, AR-29) every stored amount is Decimal128, so a JS
 * `number` here means the migration was not run before this code was deployed (DV-34). A lean
 * read is not cast by Mongoose, so without this check such a number would be read silently.
 */
export function fromDecimal128(value: Types.Decimal128): Decimal {
  if (!isDecimal128(value)) {
    throw new TypeError('Stored money is not Decimal128: run the migrations first (AR-29, DV-34)');
  }
  return new Decimal(value.toString());
}

/** As fromDecimal128, keeping an absent amount absent. */
export function fromDecimal128OrNull(value: Types.Decimal128 | null | undefined): Decimal | null {
  return value === null || value === undefined ? null : fromDecimal128(value);
}
