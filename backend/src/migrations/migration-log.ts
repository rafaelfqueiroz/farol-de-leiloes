// AR-29: which migrations a database has applied. The runner depends on this port, so its
// ordering and stop-on-failure rules are unit-tested with an in-memory fake (TS-03) and the
// MongoDB implementation is covered by the integration spec (TS-02).
import type { mongo } from 'mongoose';

/** The collection that records applied migrations, one document per id. */
export const MIGRATIONS_COLLECTION = 'migrations';

export interface MigrationLog {
  /** Ids of every migration recorded as applied. */
  appliedIds(): Promise<ReadonlySet<string>>;
  /** Records `id` as applied at `appliedAt`. Fails if it is already recorded. */
  record(id: string, appliedAt: Date): Promise<void>;
}

/** `{ _id: '0001-money-decimal128', appliedAt: ISODate(...) }` */
interface AppliedMigrationDocument {
  _id: string;
  appliedAt: Date;
}

/**
 * The log kept in the `migrations` collection. The id is the document's `_id`, so the unique
 * `_id` index makes a second record of the same id fail instead of duplicating it.
 */
export function mongoMigrationLog(db: mongo.Db): MigrationLog {
  const collection = db.collection<AppliedMigrationDocument>(MIGRATIONS_COLLECTION);
  return {
    async appliedIds() {
      const applied = await collection.find({}, { projection: { _id: 1 } }).toArray();
      return new Set(applied.map((document) => document._id));
    },
    async record(id, appliedAt) {
      await collection.insertOne({ _id: id, appliedAt });
    },
  };
}
