// SPEC-009 (#9) BR-009-17, AR-29: 0013-account-status-events-indexes against a real MongoDB, on a
// database no Mongoose model has touched (so nothing but the migration builds an index). Running twice
// changes nothing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection, type mongo } from 'mongoose';
import { createAccountStatusEventsIndexes } from '../../src/migrations/0013-account-status-events-indexes.migration.js';
import { useTestDatabase } from '../support/test-database.js';

describe('0013-account-status-events-indexes (integration)', () => {
  const testDb = useTestDatabase();
  let connection: Connection;
  let db: mongo.Db;

  const indexNames = async () =>
    (await db.collection('accountStatusEvents').indexes())
      .map((index) => index.name as string)
      .sort();

  beforeAll(async () => {
    connection = await createConnection(testDb.uri).asPromise();
    if (!connection.db) throw new Error('connection has no db');
    db = connection.db;
  });

  afterAll(async () => {
    await connection.close();
  });

  it('creates the history index on an empty collection', async () => {
    await createAccountStatusEventsIndexes(db);

    expect(await indexNames()).toEqual(['_id_', 'userId_1_at_-1']);
  });

  it('is idempotent (AR-29): running it again changes nothing', async () => {
    const before = await indexNames();

    await createAccountStatusEventsIndexes(db);

    expect(await indexNames()).toEqual(before);
  });
});
