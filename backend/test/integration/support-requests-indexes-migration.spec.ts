// SPEC-009 (#9) BR-009-06, AR-29: 0012-support-requests-indexes against a real MongoDB, on a database
// no Mongoose model has touched (so nothing but the migration builds an index). The protocol must be
// unique on the migration's index alone; running twice changes nothing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection, type mongo, Types } from 'mongoose';
import { createSupportRequestsIndexes } from '../../src/migrations/0012-support-requests-indexes.migration.js';
import { useTestDatabase } from '../support/test-database.js';

describe('0012-support-requests-indexes (integration)', () => {
  const testDb = useTestDatabase();
  let connection: Connection;
  let db: mongo.Db;

  const indexNames = async () =>
    (await db.collection('supportRequests').indexes()).map((index) => index.name as string).sort();

  beforeAll(async () => {
    connection = await createConnection(testDb.uri).asPromise();
    if (!connection.db) throw new Error('connection has no db');
    db = connection.db;
  });

  afterAll(async () => {
    await connection.close();
  });

  it('creates the four indexes on an empty collection', async () => {
    await createSupportRequestsIndexes(db);

    expect(await indexNames()).toEqual([
      '_id_',
      'mailNextAttemptAt_1',
      'protocol_1',
      'status_1_createdAt_-1',
      'userId_1_createdAt_-1',
    ]);
  });

  it('BR-009-06: refuses a second request with the same protocol, never another protocol', async () => {
    const requests = db.collection('supportRequests');
    const row = { userId: new Types.ObjectId(), status: 'open', createdAt: new Date('2099-01-15') };

    await requests.insertOne({ ...row, protocol: 'FL-2099-000001' });
    await expect(requests.insertOne({ ...row, protocol: 'FL-2099-000001' })).rejects.toMatchObject({
      code: 11000,
    });
    await requests.insertOne({ ...row, protocol: 'FL-2099-000002' });
  });

  it('BR-009-07: the outbox index is partial, so a request that owes nothing is not in it', async () => {
    const index = (await db.collection('supportRequests').indexes()).find(
      (entry) => entry.name === 'mailNextAttemptAt_1',
    );

    expect(index?.['partialFilterExpression']).toEqual({ mailNextAttemptAt: { $exists: true } });
  });

  it('is idempotent (AR-29): running it again changes nothing', async () => {
    const before = await indexNames();

    await createSupportRequestsIndexes(db);

    expect(await indexNames()).toEqual(before);
  });
});
