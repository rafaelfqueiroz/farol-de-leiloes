// SPEC-010 (#10) BR-010-21, BR-010-26, AR-29: 0010-retention-legal-indexes against a real MongoDB, on a
// database no Mongoose model has touched (so nothing but the migration builds an index). One log row
// per journey must hold on the migration's index alone; running twice changes nothing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection, type mongo, Types } from 'mongoose';
import { createRetentionLegalIndexes } from '../../src/migrations/0010-retention-legal-indexes.migration.js';
import { useTestDatabase } from '../support/test-database.js';

describe('0010-retention-legal-indexes (integration)', () => {
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
    await createRetentionLegalIndexes(db);

    expect(await indexNames('retentionDeletions')).toEqual(['_id_', 'one_deletion_per_journey']);
    expect(await indexNames('legalValidations')).toEqual(['_id_', 'scope_1_validatedAt_-1']);
  });

  it('BR-010-21: refuses a second log row for one journey, never another journey', async () => {
    const rows = db.collection('retentionDeletions');
    const journey = new Types.ObjectId();
    const row = { journeyOwnerType: 'office', fileCount: 3, deletedAt: new Date('2099-01-15') };

    await rows.insertOne({ ...row, journeyId: journey, journeyOwnerId: new Types.ObjectId() });
    await expect(
      rows.insertOne({ ...row, journeyId: journey, journeyOwnerId: new Types.ObjectId() }),
    ).rejects.toMatchObject({ code: 11000 });
    await rows.insertOne({
      ...row,
      journeyId: new Types.ObjectId(),
      journeyOwnerId: new Types.ObjectId(),
    });
  });

  it('is idempotent (AR-29): running it again changes nothing', async () => {
    const before = await indexNames('retentionDeletions');

    await createRetentionLegalIndexes(db);

    expect(await indexNames('retentionDeletions')).toEqual(before);
    expect(await indexNames('legalValidations')).toHaveLength(2);
  });
});
