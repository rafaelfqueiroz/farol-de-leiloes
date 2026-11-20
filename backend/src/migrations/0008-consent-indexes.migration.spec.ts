// SPEC-010 (#10) BR-010-03, BR-010-27, AR-29: 0008-consent-indexes against a recording fake of the
// driver (TS-04: the expectations are the exact index specs). That they equal the schemas' is
// privacy/schemas/consent-indexes.spec.ts; the run against MongoDB is
// test/integration/consent-indexes-migration.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import type { mongo } from 'mongoose';
import { consentIndexes, createConsentIndexes } from './0008-consent-indexes.migration.js';

function fakeDb() {
  const createIndexes = vi.fn((indexes: mongo.IndexDescription[]) =>
    Promise.resolve(indexes.map((index) => index.name ?? Object.keys(index.key).join('_'))),
  );
  const collection = vi.fn().mockReturnValue({ createIndexes });
  return { db: { collection } as unknown as mongo.Db, collection, createIndexes };
}

describe('createConsentIndexes', () => {
  it('creates the unique acceptance per version and the latest-answer read', async () => {
    const { db, collection, createIndexes } = fakeDb();

    await expect(createConsentIndexes(db)).resolves.toEqual({
      consents: ['one_acceptance_per_version'],
      whatsappConsents: ['userId_at'],
    });

    expect(collection.mock.calls).toEqual([['consents'], ['whatsappConsents']]);
    expect(createIndexes).toHaveBeenNthCalledWith(1, [
      {
        key: { userId: 1, documentType: 1, version: 1 },
        name: 'one_acceptance_per_version',
        unique: true,
      },
    ]);
    expect(createIndexes).toHaveBeenNthCalledWith(2, [{ key: { userId: 1, at: -1 } }]);
  });

  it('fails the run when the driver refuses an index (the deploy stops, DV-34)', async () => {
    const { db, createIndexes } = fakeDb();
    createIndexes.mockRejectedValueOnce(new Error('IndexOptionsConflict'));

    await expect(createConsentIndexes(db)).rejects.toThrow('IndexOptionsConflict');
  });

  it('is a registered migration that logs index names only', async () => {
    const { db } = fakeDb();

    expect(consentIndexes.id).toBe('0008-consent-indexes');
    await expect(consentIndexes.up(db)).resolves.toBeUndefined();
  });
});
