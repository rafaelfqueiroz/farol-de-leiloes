// SPEC-004 AR-29: 0012-auction-import-model against a recording fake of the driver (TS-04: the
// expectations are the exact index specs and the rounds the backfill writes). That the indexes
// equal the schemas' is auctions/schemas/auction-import-indexes.spec.ts; the run against MongoDB
// is test/integration/auction-import-migration.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import type { mongo } from 'mongoose';
import {
  auctionImportModel,
  backfillRounds,
  createAuctionImportIndexes,
  roundsOfPhaseDates,
} from './0012-auction-import-model.migration.js';

const FIRST = new Date('2026-03-10T13:00:00Z');
const SECOND = new Date('2026-03-16T13:00:00Z');

function fakeDb(docs: Record<string, unknown>[] = []) {
  const createIndexes = vi.fn((indexes: mongo.IndexDescription[]) =>
    Promise.resolve(indexes.map((index) => index.name ?? Object.keys(index.key).join('_'))),
  );
  const bulkWrite = vi.fn((ops: unknown[]) => Promise.resolve({ modifiedCount: ops.length }));
  const find = vi.fn(() => ({
    async *[Symbol.asyncIterator]() {
      for (const doc of docs) yield doc;
    },
  }));
  const collection = vi.fn().mockReturnValue({ createIndexes, bulkWrite, find });
  return { db: { collection } as unknown as mongo.Db, collection, createIndexes, bulkWrite, find };
}

describe('createAuctionImportIndexes', () => {
  it('creates the indexes of the auctions, the import runs and the change entries', async () => {
    const { db, collection, createIndexes } = fakeDb();

    await expect(createAuctionImportIndexes(db)).resolves.toEqual({
      auctions: [
        'available_rounds.date',
        'available_detailsCollectedAt',
        'propertyType',
        'lastSeenRunId_available',
        'lastChangedRunId',
      ],
      importruns: ['one_run_per_brasilia_date', 'outcome_brasiliaDate'],
      propertychanges: [
        'importRunId',
        'propertyCode_createdAt',
        'relevant_createdAt',
        'one_change_per_run_property_field',
      ],
    });
    expect(collection.mock.calls).toEqual([['auctions'], ['importruns'], ['propertychanges']]);
    expect(createIndexes).toHaveBeenNthCalledWith(2, [
      { key: { brasiliaDate: 1 }, name: 'one_run_per_brasilia_date', unique: true },
      { key: { outcome: 1, brasiliaDate: -1 } },
    ]);
    expect(createIndexes).toHaveBeenNthCalledWith(3, [
      { key: { importRunId: 1 } },
      { key: { propertyCode: 1, createdAt: -1 } },
      { key: { relevant: 1, createdAt: 1 } },
      {
        key: { importRunId: 1, propertyCode: 1, field: 1 },
        name: 'one_change_per_run_property_field',
        unique: true,
      },
    ]);
  });

  it('fails the run when the driver refuses an index (the deploy stops, DV-34)', async () => {
    const { db, createIndexes } = fakeDb();
    createIndexes.mockRejectedValueOnce(new Error('IndexOptionsConflict'));

    await expect(createAuctionImportIndexes(db)).rejects.toThrow('IndexOptionsConflict');
  });
});

describe('roundsOfPhaseDates', () => {
  it('labels an SFI auction 1st and 2nd round, in the order stored', () => {
    expect(roundsOfPhaseDates('SFI_AUCTION', [FIRST, SECOND])).toEqual([
      { label: '1º Leilão', minimumPrice: null, date: FIRST },
      { label: '2º Leilão', minimumPrice: null, date: SECOND },
    ]);
  });

  it('keeps one dated round of open bidding and of an online sale', () => {
    expect(roundsOfPhaseDates('OPEN_BIDDING', [FIRST, SECOND])).toEqual([
      { label: 'Licitação', minimumPrice: null, date: FIRST },
    ]);
    expect(roundsOfPhaseDates('ONLINE_SALES', [FIRST])).toEqual([
      { label: 'Venda Online', minimumPrice: null, date: FIRST },
    ]);
  });

  it('writes nothing for another modality or for values that are not dates (unknown)', () => {
    expect(roundsOfPhaseDates('DIRECT_ONLINE_SALES', [FIRST])).toEqual([]);
    expect(roundsOfPhaseDates(undefined, [FIRST])).toEqual([]);
    expect(roundsOfPhaseDates('SFI_AUCTION', ['2026-03-10', 5])).toEqual([]);
  });
});

describe('backfillRounds', () => {
  it('selects only auctions with dates and no rounds, and writes rounds only where none exist', async () => {
    const { db, find, bulkWrite } = fakeDb([
      { _id: 'a', currentPhase: { modality: 'SFI_AUCTION', phaseDates: [FIRST, SECOND] } },
      { _id: 'b', currentPhase: { modality: 'DIRECT_ONLINE_SALES', phaseDates: [FIRST] } },
      { _id: 'c' },
    ]);

    await expect(backfillRounds(db)).resolves.toBe(1);

    expect(find).toHaveBeenCalledWith(
      { rounds: { $exists: false }, 'currentPhase.phaseDates.0': { $exists: true } },
      { projection: { 'currentPhase.modality': 1, 'currentPhase.phaseDates': 1 } },
    );
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    expect(bulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: { _id: 'a', rounds: { $exists: false } },
            update: {
              $set: {
                rounds: [
                  { label: '1º Leilão', minimumPrice: null, date: FIRST },
                  { label: '2º Leilão', minimumPrice: null, date: SECOND },
                ],
              },
            },
          },
        },
      ],
      { ordered: false },
    );
  });

  it('writes nothing when there is nothing to backfill', async () => {
    const { db, bulkWrite } = fakeDb([]);

    await expect(backfillRounds(db)).resolves.toBe(0);
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it('flushes in chunks of 500', async () => {
    const docs = Array.from({ length: 1001 }, (_, index) => ({
      _id: index,
      currentPhase: { modality: 'ONLINE_SALES', phaseDates: [FIRST] },
    }));
    const { db, bulkWrite } = fakeDb(docs);

    await expect(backfillRounds(db)).resolves.toBe(1001);
    expect(bulkWrite.mock.calls.map(([ops]) => (ops as unknown[]).length)).toEqual([500, 500, 1]);
  });
});

describe('the registered migration', () => {
  it('has its id and logs counts and index names only', async () => {
    const { db } = fakeDb();

    expect(auctionImportModel.id).toBe('0012-auction-import-model');
    await expect(auctionImportModel.up(db)).resolves.toBeUndefined();
  });
});
