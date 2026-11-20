// SPEC-010 (#10) BR-010-21, BR-010-26, AR-29: 0010-retention-legal-indexes against a recording fake of
// the driver (TS-04: the expectations are the exact index specs). That they equal the schemas' is
// privacy/schemas/retention-legal-indexes.spec.ts; the run against MongoDB is
// test/integration/retention-legal-indexes-migration.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import type { mongo } from 'mongoose';
import {
  createRetentionLegalIndexes,
  retentionLegalIndexes,
} from './0010-retention-legal-indexes.migration.js';

function fakeDb() {
  const createIndexes = vi.fn((indexes: mongo.IndexDescription[]) =>
    Promise.resolve(indexes.map((index) => index.name ?? Object.keys(index.key).join('_'))),
  );
  const collection = vi.fn().mockReturnValue({ createIndexes });
  return { db: { collection } as unknown as mongo.Db, collection, createIndexes };
}

describe('createRetentionLegalIndexes', () => {
  it('creates the unique log row per journey and the newest-validations scan', async () => {
    const { db, collection, createIndexes } = fakeDb();

    await expect(createRetentionLegalIndexes(db)).resolves.toEqual({
      retentionDeletions: ['one_deletion_per_journey'],
      legalValidations: ['scope_validatedAt'],
    });

    expect(collection.mock.calls).toEqual([['retentionDeletions'], ['legalValidations']]);
    expect(createIndexes).toHaveBeenNthCalledWith(1, [
      { key: { journeyId: 1 }, name: 'one_deletion_per_journey', unique: true },
    ]);
    expect(createIndexes).toHaveBeenNthCalledWith(2, [{ key: { scope: 1, validatedAt: -1 } }]);
  });

  it('fails the run when the driver refuses an index (the deploy stops, DV-34)', async () => {
    const { db, createIndexes } = fakeDb();
    createIndexes.mockRejectedValueOnce(new Error('IndexOptionsConflict'));

    await expect(createRetentionLegalIndexes(db)).rejects.toThrow('IndexOptionsConflict');
  });

  it('is a registered migration that logs index names only', async () => {
    const { db } = fakeDb();

    expect(retentionLegalIndexes.id).toBe('0010-retention-legal-indexes');
    await expect(retentionLegalIndexes.up(db)).resolves.toBeUndefined();
  });
});
