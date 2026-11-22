// SPEC-010 (#10) BR-010-11, BR-010-15, BR-010-28, AR-29: 0009-privacy-rights-indexes against a
// recording fake of the driver (TS-04: the expectations are the exact index specs). That they equal
// the schemas' is privacy/schemas/rights-indexes.spec.ts; the run against MongoDB is
// test/integration/privacy-rights-indexes-migration.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import type { mongo } from 'mongoose';
import {
  createPrivacyRightsIndexes,
  privacyRightsIndexes,
} from './0009-privacy-rights-indexes.migration.js';

function fakeDb() {
  const createIndexes = vi.fn((indexes: mongo.IndexDescription[]) =>
    Promise.resolve(indexes.map((index) => index.name ?? Object.keys(index.key).join('_'))),
  );
  const collection = vi.fn().mockReturnValue({ createIndexes });
  return { db: { collection } as unknown as mongo.Db, collection, createIndexes };
}

describe('createPrivacyRightsIndexes', () => {
  it('creates the live-export guard, the queue scans, the pseudonym guards and the purge scan', async () => {
    const { db, collection, createIndexes } = fakeDb();

    await expect(createPrivacyRightsIndexes(db)).resolves.toEqual({
      dataExports: [
        'one_live_export_per_user',
        'userId_requestedAt',
        'status_requestedAt',
        'status_expiresAt',
      ],
      actorPseudonyms: [
        'one_pseudonym_per_person_and_journey',
        'one_person_per_pseudonym_in_journey',
        'pseudonyms_of_user',
      ],
      users: [
        'status_closedAt',
        'status_lastPurgeAttemptAt_purgeAttempts_closedAt',
        'residueSweepDueAt',
      ],
    });

    expect(collection.mock.calls).toEqual([['dataExports'], ['actorPseudonyms'], ['users']]);
    expect(createIndexes).toHaveBeenNthCalledWith(1, [
      {
        key: { userId: 1 },
        name: 'one_live_export_per_user',
        unique: true,
        partialFilterExpression: { live: true },
      },
      { key: { userId: 1, requestedAt: -1 } },
      { key: { status: 1, requestedAt: 1 } },
      { key: { status: 1, expiresAt: 1 } },
    ]);
    expect(createIndexes).toHaveBeenNthCalledWith(2, [
      {
        key: { journeyId: 1, userId: 1 },
        name: 'one_pseudonym_per_person_and_journey',
        unique: true,
        partialFilterExpression: { userId: { $type: 'objectId' } },
      },
      {
        key: { journeyId: 1, pseudonym: 1 },
        name: 'one_person_per_pseudonym_in_journey',
        unique: true,
      },
      {
        key: { userId: 1 },
        name: 'pseudonyms_of_user',
        partialFilterExpression: { userId: { $type: 'objectId' } },
      },
    ]);
    expect(createIndexes).toHaveBeenNthCalledWith(3, [
      { key: { status: 1, closedAt: 1 } },
      { key: { status: 1, lastPurgeAttemptAt: 1, purgeAttempts: 1, closedAt: 1 } },
      { key: { residueSweepDueAt: 1 }, sparse: true },
    ]);
  });

  it('fails the run when the driver refuses an index (the deploy stops, DV-34)', async () => {
    const { db, createIndexes } = fakeDb();
    createIndexes.mockRejectedValueOnce(new Error('IndexOptionsConflict'));

    await expect(createPrivacyRightsIndexes(db)).rejects.toThrow('IndexOptionsConflict');
  });

  it('is a registered migration that logs index names only', async () => {
    const { db } = fakeDb();

    expect(privacyRightsIndexes.id).toBe('0009-privacy-rights-indexes');
    await expect(privacyRightsIndexes.up(db)).resolves.toBeUndefined();
  });
});
