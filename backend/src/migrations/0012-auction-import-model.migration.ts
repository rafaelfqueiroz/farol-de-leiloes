// SPEC-004 (#4) part 2, AR-28 / AR-29: the EXPAND step of the daily import's data model.
//
//   auctions       the indexes of the new fields (rounds, detailsCollectedAt, propertyType, the run
//                  stamps), and a backfill of `rounds` from the dates the scraper already stored
//   importruns     the unique run per Brasília day, and the last-SUCCESS lookup (BR-004-27)
//   propertychanges  the change-entry indexes, with the unique (run, property, field, type) that makes
//                  writing the same list's entries twice end with one of each (BR-004-07)
//
// Old readers keep working: nothing is removed or renamed, `phases` / `currentPhase` stay as they
// were, and a property with no `rounds` is read as "not collected yet" (BR-004-15). The CONTRACT
// step (dropping `availabilityCheckedAt`, the per-phase `phaseDates`) is a later release.
//
// Why a backfill: before this, the scraper kept a property's dates in `currentPhase.phaseDates`.
// The active predicate (BR-004-16) now reads `rounds`, and a property whose rounds are absent counts
// as "not collected yet" and active, so without the backfill every already-scraped property whose
// auction is over would look active until its page is collected again. The label of a round is
// inferred from the modality and the order of the dates, exactly as the scraper's own bridge writes
// it (auctions/domain/rounds.ts `roundsFromPhaseDates`; copied here, a migration must keep doing
// what it did when it was written). The round prices are not known from the old shape: null.
//
// The index specs are the ones the schemas declare (auctions/schemas/auction-import-indexes.spec.ts
// fails on any drift). Idempotent (AR-29): createIndexes with an index that exists with the same
// keys and options is a no-op, and the backfill selects only auctions with no `rounds` yet. Names
// and counts are logged, never a document (SC-15).
import { Logger } from '@nestjs/common';
import type { mongo } from 'mongoose';
import type { Migration } from './migration.js';

export const AUCTION_IMPORT_INDEXES: Readonly<Record<string, readonly mongo.IndexDescription[]>> = {
  auctions: [
    // Already declared by the schema (`code`), ensured here so a catalogue the old importer left
    // without it, or a deploy where autoIndex is off, cannot hold two documents of one property
    // (BR-004-05). Idempotent: the same keys and options are a no-op.
    { key: { code: 1 }, unique: true },
    { key: { available: 1, 'rounds.date': 1 } },
    { key: { available: 1, detailsCollectedAt: 1 } },
    { key: { propertyType: 1 } },
    { key: { lastSeenRunId: 1, available: 1 } },
    { key: { lastChangedRunId: 1 } },
  ],
  importruns: [
    { key: { brasiliaDate: 1 }, name: 'one_run_per_brasilia_date', unique: true },
    { key: { outcome: 1, brasiliaDate: -1 } },
  ],
  propertychanges: [
    { key: { importRunId: 1 } },
    { key: { propertyCode: 1, createdAt: -1 } },
    { key: { relevant: 1, createdAt: 1 } },
    {
      key: { importRunId: 1, propertyCode: 1, field: 1, type: 1 },
      name: 'one_change_per_run_property_field_type',
      unique: true,
    },
  ],
};

/** Creates every index above; answers the index names per collection. */
export async function createAuctionImportIndexes(db: mongo.Db): Promise<Record<string, string[]>> {
  const created: Record<string, string[]> = {};
  for (const [collection, indexes] of Object.entries(AUCTION_IMPORT_INDEXES)) {
    created[collection] = await db.collection(collection).createIndexes([...indexes]);
  }
  return created;
}

interface Round {
  label: string;
  minimumPrice: null;
  date: Date | null;
}

/** The rounds of a stored phase's dates, by modality; [] when they do not say (unknown). */
export function roundsOfPhaseDates(modality: unknown, dates: readonly unknown[]): Round[] {
  const real = dates.filter((date): date is Date => date instanceof Date);
  switch (modality) {
    case 'SFI_AUCTION':
      return real.map((date, index) => ({
        label: `${index + 1}º Leilão`,
        minimumPrice: null,
        date,
      }));
    case 'OPEN_BIDDING':
      return real.slice(0, 1).map((date) => ({ label: 'Licitação', minimumPrice: null, date }));
    case 'ONLINE_SALES':
      return real.slice(0, 1).map((date) => ({ label: 'Venda Online', minimumPrice: null, date }));
    default:
      return [];
  }
}

const BACKFILL_CHUNK = 500;

/**
 * Writes `rounds` for every auction that has dates stored in its current phase and no `rounds`
 * yet. Answers how many it wrote. A second run finds none.
 */
export async function backfillRounds(db: mongo.Db): Promise<number> {
  const auctions = db.collection('auctions');
  const cursor = auctions.find(
    { rounds: { $exists: false }, 'currentPhase.phaseDates.0': { $exists: true } },
    { projection: { 'currentPhase.modality': 1, 'currentPhase.phaseDates': 1 } },
  );
  let written = 0;
  let batch: mongo.AnyBulkWriteOperation[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const result = await auctions.bulkWrite(batch, { ordered: false });
    written += result.modifiedCount;
    batch = [];
  };
  for await (const doc of cursor) {
    const rounds = roundsOfPhaseDates(
      doc['currentPhase']?.modality,
      doc['currentPhase']?.phaseDates ?? [],
    );
    if (rounds.length === 0) continue;
    // `rounds` absent in the filter too: a concurrent writer's rounds are never overwritten.
    batch.push({
      updateOne: {
        filter: { _id: doc._id, rounds: { $exists: false } },
        update: { $set: { rounds } },
      },
    });
    if (batch.length >= BACKFILL_CHUNK) await flush();
  }
  await flush();
  return written;
}

export const auctionImportModel: Migration = {
  id: '0012-auction-import-model',
  description:
    'auctions: indexes of rounds and the import stamps, rounds backfilled from stored phase dates; importruns and propertychanges: their indexes (SPEC-004)',
  async up(db) {
    const created = await createAuctionImportIndexes(db);
    const backfilled = await backfillRounds(db);
    new Logger('Migrations').log(
      `0012-auction-import-model ${JSON.stringify(created)} roundsBackfilled=${backfilled}`,
    );
  },
};
