// SPEC-010 BR-010-03 / AR-30: the acceptance and consent records are proof, so they are insert-only.
// The repositories expose no update or delete; this is the defence behind them (the same pattern as
// the admin access log): even code that reached the model could not change a row through Mongoose.
import type { Schema } from 'mongoose';

/** The operations that would edit or delete a row. All refused. */
export const INSERT_ONLY_FORBIDDEN_QUERIES = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'replaceOne',
  'deleteOne',
  'deleteMany',
] as const;

export function makeInsertOnly(schema: Schema, collection: string): void {
  const refuse = (): never => {
    throw new Error(`${collection} is insert-only (SPEC-010 BR-010-03, AR-30)`);
  };
  schema.pre([...INSERT_ONLY_FORBIDDEN_QUERIES], refuse);
  schema.pre('bulkWrite', refuse);
  schema.pre('save', function (this: { isNew: boolean }) {
    if (!this.isNew) refuse();
  });
}
