// SPEC-010 BR-010-03 / AR-30: the acceptance and consent rows can only be inserted. The middleware is
// the defence behind the repositories (which expose no update or delete): every operation that
// would edit or delete a row is refused by the schema before any query is sent (so these run on a
// private Mongoose instance with no connection). The same refusals against a live database are in
// test/integration/privacy.spec.ts.
import { describe, expect, it } from 'vitest';
import { Mongoose, Types } from 'mongoose';
import { ConsentSchema } from './consent.schema.js';
import { INSERT_ONLY_FORBIDDEN_QUERIES } from './insert-only.js';
import { WhatsappConsentSchema } from './whatsapp-consent.schema.js';

describe.each([
  ['consents', ConsentSchema],
  ['whatsappConsents', WhatsappConsentSchema],
])('%s is insert-only (AR-30)', (collection, schema) => {
  const model = new Mongoose().model(`Probe-${collection}`, schema);
  const refusal = `${collection} is insert-only`;

  it.each(INSERT_ONLY_FORBIDDEN_QUERIES)('refuses %s', async (operation) => {
    const filter = { userId: new Types.ObjectId() };
    const attempt = {
      updateOne: () => model.updateOne(filter, { $set: { version: 'x' } }).exec(),
      updateMany: () => model.updateMany(filter, { $set: { version: 'x' } }).exec(),
      findOneAndUpdate: () => model.findOneAndUpdate(filter, { $set: { version: 'x' } }).exec(),
      findOneAndReplace: () => model.findOneAndReplace(filter, {}).exec(),
      findOneAndDelete: () => model.findOneAndDelete(filter).exec(),
      replaceOne: () => model.replaceOne(filter, {}).exec(),
      deleteOne: () => model.deleteOne(filter).exec(),
      deleteMany: () => model.deleteMany(filter).exec(),
    }[operation];

    await expect(attempt()).rejects.toThrow(refusal);
  });

  it('refuses a bulk write', async () => {
    await expect(
      model.bulkWrite([{ deleteOne: { filter: { userId: new Types.ObjectId() } } }]),
    ).rejects.toThrow(refusal);
  });

  it('refuses saving a document that already exists', async () => {
    const stored = new model({});
    stored.isNew = false;
    await expect(stored.save({ validateBeforeSave: false })).rejects.toThrow(refusal);
  });
});
