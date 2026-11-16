// SPEC-002 (#2), AR-29: 0004-admin-capability against a real MongoDB. Users are seeded in the shapes
// written before the change (an admin role with no flag, plan tiers with no flag) next to documents
// already in the new shape; the migration runs twice and the second run must change nothing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection, type mongo } from 'mongoose';
import { copyAdminRoleToFlag } from '../../src/migrations/0004-admin-capability.migration.js';
import { useTestDatabase } from '../support/test-database.js';

describe('0004-admin-capability (integration)', () => {
  const testDb = useTestDatabase();
  let connection: Connection;
  let db: mongo.Db;

  const user = (email: string) => db.collection('users').findOne({ email });
  const all = () => db.collection('users').find({}).sort({ email: 1 }).toArray();

  beforeAll(async () => {
    connection = await createConnection(testDb.uri).asPromise();
    if (!connection.db) throw new Error('connection has no db');
    db = connection.db;
    await db.collection('users').insertMany([
      { email: 'legacy-admin@example.test', name: 'Legacy Admin', role: 'admin' },
      { email: 'premium@example.test', name: 'Premium', role: 'premium' },
      { email: 'free@example.test', name: 'Free', role: 'free' },
      // Already in the new shape: an admin, and a premium account granted admin by the script.
      { email: 'flagged@example.test', name: 'Flagged', role: 'admin', isAdmin: true },
      { email: 'operator@example.test', name: 'Operator', role: 'standard', isAdmin: true },
      { email: 'not-admin@example.test', name: 'Not Admin', role: 'standard', isAdmin: false },
    ]);
  });

  afterAll(async () => {
    await connection.close();
  });

  it("flags every 'admin' role account and backfills false for the rest", async () => {
    await expect(copyAdminRoleToFlag(db)).resolves.toEqual({
      adminsFlagged: 1, // legacy-admin
      flagBackfilled: 2, // premium, free
    });

    expect(await user('legacy-admin@example.test')).toMatchObject({ role: 'admin', isAdmin: true });
    expect(await user('premium@example.test')).toMatchObject({ role: 'premium', isAdmin: false });
    expect(await user('free@example.test')).toMatchObject({ isAdmin: false });
  });

  it('keeps the plan tier and every flag already set', async () => {
    expect(await user('flagged@example.test')).toMatchObject({ role: 'admin', isAdmin: true });
    expect(await user('operator@example.test')).toMatchObject({ role: 'standard', isAdmin: true });
    expect(await user('not-admin@example.test')).toMatchObject({ isAdmin: false });
  });

  it('a second run changes nothing', async () => {
    const before = await all();

    await expect(copyAdminRoleToFlag(db)).resolves.toEqual({
      adminsFlagged: 0,
      flagBackfilled: 0,
    });

    expect(await all()).toEqual(before);
  });
});
