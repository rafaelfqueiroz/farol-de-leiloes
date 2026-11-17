// SPEC-002 (#2) BR-002-24, AR-29: 0005-admin-access-indexes against a real MongoDB, on a database no
// Mongoose model has touched (so nothing but the migration builds an index). The partial unique
// index must hold the open race on its own: a second OPEN grant of a request is refused, an ENDED
// one is not. Running twice changes nothing. (That it also coexists with the indexes Mongoose's
// autoIndex builds at boot is shown by test/isolation/support-grants.isolation.spec.ts, which runs
// it on the booted app's database; the unit spec holds the specs equal to the schemas'.)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection, type mongo, Types } from 'mongoose';
import { createAdminAccessIndexes } from '../../src/migrations/0005-admin-access-indexes.migration.js';
import { useTestDatabase } from '../support/test-database.js';

describe('0005-admin-access-indexes (integration)', () => {
  const testDb = useTestDatabase();
  let connection: Connection;
  let db: mongo.Db;

  const indexesOf = async (name: string) =>
    (await db.collection(name).indexes())
      .map(({ key, name: indexName, unique, partialFilterExpression }) => ({
        key,
        name: indexName,
        ...(unique ? { unique } : {}),
        ...(partialFilterExpression ? { partialFilterExpression } : {}),
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const grant = (supportRequestId: Types.ObjectId, status: 'open' | 'ended') => ({
    supportRequestId,
    adminUserId: new Types.ObjectId(),
    requesterUserId: new Types.ObjectId(),
    openedAt: new Date('2099-01-15T12:00:00.000Z'),
    expiresAt: new Date('2099-01-22T12:00:00.000Z'),
    status,
  });

  beforeAll(async () => {
    connection = await createConnection(testDb.uri).asPromise();
    if (!connection.db) throw new Error('connection has no db');
    db = connection.db;
  });

  afterAll(async () => {
    await connection.close();
  });

  it('creates the partial unique index and the read indexes on empty collections', async () => {
    await createAdminAccessIndexes(db);

    expect(await indexesOf('supportAccessGrants')).toEqual([
      { key: { _id: 1 }, name: '_id_' },
      { key: { adminUserId: 1, openedAt: -1 }, name: 'adminUserId_1_openedAt_-1' },
      {
        key: { supportRequestId: 1 },
        name: 'one_open_grant_per_request',
        unique: true,
        partialFilterExpression: { status: 'open' },
      },
    ]);
    expect(await indexesOf('adminAccessLogs')).toEqual([
      { key: { _id: 1 }, name: '_id_' },
      { key: { adminUserId: 1, at: -1 }, name: 'adminUserId_1_at_-1' },
      { key: { 'owner.id': 1, at: -1 }, name: 'owner.id_1_at_-1' },
    ]);
  });

  it('BR-002-24: refuses a second open grant of a request, never an ended one', async () => {
    const grants = db.collection('supportAccessGrants');
    const request = new Types.ObjectId();

    await grants.insertOne(grant(request, 'open'));
    await expect(grants.insertOne(grant(request, 'open'))).rejects.toMatchObject({ code: 11000 });
    await grants.insertOne(grant(request, 'ended'));
    await grants.insertOne(grant(request, 'ended'));

    expect(await grants.countDocuments({ supportRequestId: request })).toBe(3);
  });

  it('a second run changes nothing (idempotent, AR-29)', async () => {
    const before = [await indexesOf('supportAccessGrants'), await indexesOf('adminAccessLogs')];

    await createAdminAccessIndexes(db);

    expect([await indexesOf('supportAccessGrants'), await indexesOf('adminAccessLogs')]).toEqual(
      before,
    );
  });
});
