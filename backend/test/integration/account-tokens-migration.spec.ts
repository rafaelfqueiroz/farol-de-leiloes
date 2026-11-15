// SPEC-001 (#1), AR-29: 0003-account-tokens against a real MongoDB. The users are seeded in the
// shapes written before the change (legacy token fields, no status) next to documents already in
// the new shape; the migration runs twice and the second run must change nothing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection, mongo } from 'mongoose';
import {
  LEGACY_TOKEN_FIELDS,
  moveTokensOutOfUsers,
} from '../../src/migrations/0003-account-tokens.migration.js';
import { useTestDatabase } from '../support/test-database.js';

const EXPIRES = new Date('2026-03-01T12:00:00.000Z');

describe('0003-account-tokens (integration)', () => {
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
      {
        // Everything the old code could leave behind.
        email: 'legacy-all@example.test',
        name: 'Legacy All',
        password: 'fake-hash',
        resetPasswordToken: 'fake-bcrypt-reset',
        resetPasswordExpires: EXPIRES,
        emailVerificationToken: 'fake-bcrypt-verification',
        emailVerificationExpires: EXPIRES,
      },
      { email: 'legacy-one@example.test', name: 'Legacy One', resetPasswordToken: 'fake' },
      {
        // Already migrated, and an account an admin deactivated: both must keep their status.
        email: 'current@example.test',
        name: 'Current',
        status: 'active',
      },
      { email: 'deactivated@example.test', name: 'Deactivated', status: 'deactivated' },
      { email: 'plain@example.test', name: 'Plain' },
    ]);
  });

  afterAll(async () => {
    await connection.close();
  });

  it('removes the four legacy token fields and keeps everything else', async () => {
    await expect(moveTokensOutOfUsers(db)).resolves.toEqual({
      legacyTokensRemoved: 2,
      statusBackfilled: 3, // legacy-all, legacy-one, plain
    });

    const legacy = await user('legacy-all@example.test');
    for (const field of LEGACY_TOKEN_FIELDS) expect(legacy).not.toHaveProperty(field);
    expect(legacy).toMatchObject({ name: 'Legacy All', password: 'fake-hash', status: 'active' });
    expect(await user('legacy-one@example.test')).not.toHaveProperty('resetPasswordToken');
  });

  it('sets status active only where it was missing', async () => {
    expect((await user('plain@example.test'))?.status).toBe('active');
    expect((await user('current@example.test'))?.status).toBe('active');
    expect((await user('deactivated@example.test'))?.status).toBe('deactivated');
  });

  it('a second run changes nothing', async () => {
    const before = await all();

    await expect(moveTokensOutOfUsers(db)).resolves.toEqual({
      legacyTokensRemoved: 0,
      statusBackfilled: 0,
    });

    expect(await all()).toEqual(before);
  });
});
