// SPEC-010 (#10) BR-010-11, BR-010-28, AR-29: 0009-privacy-rights-indexes against a real MongoDB, on a
// database no Mongoose model has touched (so nothing but the migration builds an index). The
// guarantees must hold on the migration's indexes alone: one live export per account, one label per
// person and journey (any number of detached rows). Running twice changes nothing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection, type mongo, Types } from 'mongoose';
import { createPrivacyRightsIndexes } from '../../src/migrations/0009-privacy-rights-indexes.migration.js';
import { useTestDatabase } from '../support/test-database.js';

describe('0009-privacy-rights-indexes (integration)', () => {
  const testDb = useTestDatabase();
  let connection: Connection;
  let db: mongo.Db;

  const indexNames = async (name: string) =>
    (await db.collection(name).indexes()).map((index) => index.name as string).sort();

  beforeAll(async () => {
    connection = await createConnection(testDb.uri).asPromise();
    if (!connection.db) throw new Error('connection has no db');
    db = connection.db;
  });

  afterAll(async () => {
    await connection.close();
  });

  it('creates the indexes on empty collections', async () => {
    await createPrivacyRightsIndexes(db);

    expect(await indexNames('dataExports')).toEqual(
      [
        '_id_',
        'one_live_export_per_user',
        'userId_1_requestedAt_-1',
        'status_1_requestedAt_1',
        'status_1_expiresAt_1',
      ].sort(),
    );
    expect(await indexNames('actorPseudonyms')).toEqual(
      [
        '_id_',
        'one_pseudonym_per_person_and_journey',
        'one_person_per_pseudonym_in_journey',
        'pseudonyms_of_user',
      ].sort(),
    );
    expect(await indexNames('users')).toEqual(
      expect.arrayContaining([
        'status_1_closedAt_1',
        'status_1_lastPurgeAttemptAt_1_purgeAttempts_1_closedAt_1',
        'residueSweepDueAt_1',
      ]),
    );
  });

  it('BR-010-11: refuses a second live export of one account, never a terminal one or another account', async () => {
    const exports = db.collection('dataExports');
    const ana = new Types.ObjectId();
    const at = new Date('2099-01-15T12:00:00.000Z');

    await exports.insertOne({ userId: ana, requestedAt: at, status: 'queued', live: true });
    await expect(
      exports.insertOne({ userId: ana, requestedAt: at, status: 'ready', live: true }),
    ).rejects.toMatchObject({ code: 11000 });
    // Any number of finished exports (no `live` flag) next to the live one.
    await exports.insertOne({ userId: ana, requestedAt: at, status: 'expired' });
    await exports.insertOne({ userId: ana, requestedAt: at, status: 'cancelled' });
    await exports.insertOne({
      userId: new Types.ObjectId(),
      requestedAt: at,
      status: 'queued',
      live: true,
    });
  });

  it('BR-010-28: one label per person and journey; detached rows never clash', async () => {
    const labels = db.collection('actorPseudonyms');
    const journey = new Types.ObjectId();
    const ana = new Types.ObjectId();

    await labels.insertOne({ journeyId: journey, userId: ana, pseudonym: 'p-aa' });
    await expect(
      labels.insertOne({ journeyId: journey, userId: ana, pseudonym: 'p-bb' }),
    ).rejects.toMatchObject({ code: 11000 });
    // Another person, another journey: fine. The same label twice in a journey: refused.
    await labels.insertOne({ journeyId: journey, userId: new Types.ObjectId(), pseudonym: 'p-cc' });
    await labels.insertOne({ journeyId: new Types.ObjectId(), userId: ana, pseudonym: 'p-dd' });
    await expect(
      labels.insertOne({ journeyId: journey, userId: new Types.ObjectId(), pseudonym: 'p-cc' }),
    ).rejects.toMatchObject({ code: 11000 });
    // Two detached people of one journey (userId null): the partial index ignores them.
    await labels.insertOne({ journeyId: journey, userId: null, pseudonym: 'p-ee' });
    await labels.insertOne({ journeyId: journey, userId: null, pseudonym: 'p-ff' });
  });

  it('is idempotent (AR-29): running it again changes nothing', async () => {
    const before = await indexNames('dataExports');

    await createPrivacyRightsIndexes(db);

    expect(await indexNames('dataExports')).toEqual(before);
    expect(await indexNames('actorPseudonyms')).toHaveLength(4);
  });
});
