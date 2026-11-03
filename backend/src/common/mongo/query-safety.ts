import mongoose from 'mongoose';

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
