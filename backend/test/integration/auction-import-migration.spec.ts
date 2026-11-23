// SPEC-004 AR-29: 0012-auction-import-model against a real MongoDB, on a database no Mongoose model
// has touched (so nothing but the migration builds an index). The unique keys must hold on the
// migration's indexes alone, the backfill must write rounds only where there are none, and running
// the migration twice must change nothing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection, type mongo, Types } from 'mongoose';
import { auctionImportModel } from '../../src/migrations/0012-auction-import-model.migration.js';
import { useTestDatabase } from '../support/test-database.js';

const FIRST = new Date('2026-03-10T13:00:00.000Z');
const SECOND = new Date('2026-03-16T13:00:00.000Z');

describe('0012-auction-import-model (integration)', () => {
  const testDb = useTestDatabase();
  let connection: Connection;
  let db: mongo.Db;

  const indexNames = async (name: string) =>
    (await db.collection(name).indexes()).map((index) => index.name as string).sort();
  const state = async () => ({
    auctions: await db.collection('auctions').find({}).sort({ code: 1 }).toArray(),
    indexes: {
      auctions: await indexNames('auctions'),
      importruns: await indexNames('importruns'),
      propertychanges: await indexNames('propertychanges'),
    },
  });

  beforeAll(async () => {
    connection = await createConnection(testDb.uri).asPromise();
    if (!connection.db) throw new Error('connection has no db');
    db = connection.db;
    const auctions = db.collection('auctions');
    await auctions.insertMany([
      // Scraped before SPEC-004: its dates live in the current phase.
      {
        code: 'SFI',
        available: true,
        currentPhase: { modality: 'SFI_AUCTION', phaseDates: [FIRST, SECOND] },
      },
      // Online sale with no date, a direct sale, and a property never scraped: nothing to derive.
      { code: 'DIRECT', currentPhase: { modality: 'DIRECT_ONLINE_SALES', phaseDates: [] } },
      { code: 'NEVER', currentPhase: { modality: 'SFI_AUCTION' } },
      // Already has rounds (written by the new collector): left exactly as it is.
      {
        code: 'NEWER',
        currentPhase: { modality: 'SFI_AUCTION', phaseDates: [FIRST] },
        rounds: [{ label: 'Venda Direta', minimumPrice: null, date: null }],
      },
    ]);
  });

  afterAll(async () => {
    await connection.close();
  });

  it('creates the indexes, backfills the rounds of stored dates, and leaves the rest unknown', async () => {
    await auctionImportModel.up(db);

    expect(await indexNames('auctions')).toEqual(
      expect.arrayContaining([
        'available_1_rounds.date_1',
        'available_1_detailsCollectedAt_1',
        'propertyType_1',
        'lastSeenRunId_1_available_1',
        'lastChangedRunId_1',
      ]),
    );
    expect(await indexNames('importruns')).toEqual([
      '_id_',
      'one_run_per_brasilia_date',
      'outcome_1_brasiliaDate_-1',
    ]);
    const byCode = async (code: string) => db.collection('auctions').findOne({ code });
    expect((await byCode('SFI'))?.['rounds']).toEqual([
      { label: '1º Leilão', minimumPrice: null, date: FIRST },
      { label: '2º Leilão', minimumPrice: null, date: SECOND },
    ]);
    // BR-004-15: nothing derived, nothing defaulted.
    expect(await byCode('DIRECT')).not.toHaveProperty('rounds');
    expect(await byCode('NEVER')).not.toHaveProperty('rounds');
    expect((await byCode('NEWER'))?.['rounds']).toEqual([
      { label: 'Venda Direta', minimumPrice: null, date: null },
    ]);
  });

  it('BR-004-27: one Import Run per Brasília day, whatever races', async () => {
    const runs = db.collection('importruns');
    await runs.insertOne({ brasiliaDate: '2026-03-10', outcome: 'RUNNING' });

    await expect(
      runs.insertOne({ brasiliaDate: '2026-03-10', outcome: 'RUNNING' }),
    ).rejects.toMatchObject({
      code: 11000,
    });
    await runs.insertOne({ brasiliaDate: '2026-03-11', outcome: 'RUNNING' });
  });

  it('BR-004-07: one change entry per run, property and field; another field or run is fine', async () => {
    const changes = db.collection('propertychanges');
    const run = new Types.ObjectId();
    const entry = { importRunId: run, propertyCode: '1', field: 'available', type: 'NEW' };

    await changes.insertOne({ ...entry });
    await expect(changes.insertOne({ ...entry })).rejects.toMatchObject({ code: 11000 });
    await changes.insertOne({ ...entry, field: 'modality' });
    await changes.insertOne({ ...entry, importRunId: new Types.ObjectId() });
  });

  it('is idempotent (AR-29): running it again changes nothing', async () => {
    const before = await state();

    await auctionImportModel.up(db);

    expect(await state()).toEqual(before);
  });
});
