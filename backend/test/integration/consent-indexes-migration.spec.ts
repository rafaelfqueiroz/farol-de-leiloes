// SPEC-010 (#10) BR-010-03, BR-010-27, AR-29: 0008-consent-indexes against a real MongoDB, on a
// database no Mongoose model has touched (so nothing but the migration builds an index). The
// guarantee must hold on the migration's index alone: one acceptance per account, document and
// version. Running twice changes nothing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection, type mongo, Types } from 'mongoose';
import { createConsentIndexes } from '../../src/migrations/0008-consent-indexes.migration.js';
import { useTestDatabase } from '../support/test-database.js';

describe('0008-consent-indexes (integration)', () => {
  const testDb = useTestDatabase();
  let connection: Connection;
  let db: mongo.Db;

  const indexesOf = async (name: string) =>
    (await db.collection(name).indexes())
      .map(({ key, name: indexName, unique }) => ({
        key,
        name: indexName,
        ...(unique ? { unique } : {}),
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const acceptance = (
    userId: Types.ObjectId,
    documentType: string,
    version: string,
    consentResetAt: Date | null = null,
  ) => ({
    userId,
    consentResetAt,
    documentType,
    version,
    contentHash: 'a'.repeat(64),
    acceptedAt: new Date('2099-01-15T12:00:00.000Z'),
    method: 'signup_email',
  });

  beforeAll(async () => {
    connection = await createConnection(testDb.uri).asPromise();
    if (!connection.db) throw new Error('connection has no db');
    db = connection.db;
  });

  afterAll(async () => {
    await connection.close();
  });

  it('creates the indexes on empty collections', async () => {
    await createConsentIndexes(db);

    expect(await indexesOf('consents')).toEqual([
      { key: { _id: 1 }, name: '_id_' },
      {
        key: { userId: 1, consentResetAt: 1, documentType: 1, version: 1 },
        name: 'one_acceptance_per_version',
        unique: true,
      },
    ]);
    expect(await indexesOf('whatsappConsents')).toEqual([
      { key: { _id: 1 }, name: '_id_' },
      { key: { userId: 1, consentResetAt: 1, at: -1 }, name: 'userId_1_consentResetAt_1_at_-1' },
    ]);
  });

  it('BR-010-03: refuses a second acceptance of one version by one account, never another version, document or account', async () => {
    const consents = db.collection('consents');
    const ana = new Types.ObjectId();

    await consents.insertOne(acceptance(ana, 'terms', '0.1'));
    await expect(consents.insertOne(acceptance(ana, 'terms', '0.1'))).rejects.toMatchObject({
      code: 11000,
    });
    await consents.insertOne(acceptance(ana, 'privacy', '0.1'));
    await consents.insertOne(acceptance(ana, 'terms', '0.2'));
    await consents.insertOne(acceptance(new Types.ObjectId(), 'terms', '0.1'));
    // DL-001-02: a new consent generation (a Google takeover) may accept the same version again.
    const owner = new Date('2099-02-01T00:00:00.000Z');
    await consents.insertOne(acceptance(ana, 'terms', '0.1', owner));
    await expect(consents.insertOne(acceptance(ana, 'terms', '0.1', owner))).rejects.toMatchObject({
      code: 11000,
    });
  });

  it('is idempotent (AR-29): running it again changes nothing', async () => {
    const before = await indexesOf('consents');

    await createConsentIndexes(db);

    expect(await indexesOf('consents')).toEqual(before);
    expect(await indexesOf('whatsappConsents')).toHaveLength(2);
  });
});
