// AR-17: in MongoDB money is a Decimal128; in code a Decimal. These two functions are the only
// crossing between them, so no amount passes through a JS `number` on the way in or out.
import { Types } from 'mongoose';
import { Decimal } from './money';

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

/** Decimal128 → Decimal, digit for digit: the string form is parsed, never a float. */
export function fromDecimal128(value: Types.Decimal128): Decimal {
  return new Decimal(value.toString());
}
