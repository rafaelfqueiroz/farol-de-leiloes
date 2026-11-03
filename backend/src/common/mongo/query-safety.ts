import mongoose, { type Types } from 'mongoose';
import { DomainError } from '../errors/domain-error';
import { toDecimal128 } from '../money/decimal128';
import { Decimal } from '../money/money';

/**
 * SC-10: request values never become MongoDB operators. With `sanitizeFilter` on, Mongoose wraps
 * any filter value that has `$` keys in `$eq`, so `{ code: { $ne: null } }` built from a request
 * matches only a literal object, never "every document". Called once, before the connection is
 * used (`AppModule`); integration specs call it too, so they run against the production setting.
 */
export function applyMongooseDefaults(): void {
  mongoose.set('sanitizeFilter', true);
}

/**
 * Marks operators the SERVER wrote (`$in`, `$gte`, `$exists`, ...) as exempt from `sanitizeFilter`
 * (SC-10). Wrap only an object literal whose operands are server-built or already validated
 * (AR-34); never a value that came from a request, because the mark is exactly what makes
 * Mongoose read its `$` keys as operators.
 */
export function serverOperators<T extends object>(operators: T): T {
  return mongoose.trusted(operators);
}

/**
 * SC-10 / AR-17: a money bound for a range filter, as the Decimal128 the stored prices are
 * compared with. Only a finite Decimal (the DTO's IsMoneyString output) passes; a number, a string
 * or an operator object is a refused request, never a query. MongoDB compares Decimal128 with a
 * legacy number price by value, so the bound serves both shapes during the expand step (AR-28).
 */
export function decimalFilter(value: unknown, field: string): Types.Decimal128 {
  if (!Decimal.isDecimal(value) || !value.isFinite()) {
    throw new DomainError('VALIDATION_FAILED', { fields: [field] });
  }
  return toDecimal128(value);
}
