import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AnyBulkWriteOperation, Model, Types } from 'mongoose';
import { serverOperators } from '../../common/mongo/query-safety.js';
import { fromDecimal128OrNull, toDecimal128OrNull } from '../../common/money/decimal128.js';
import { fromStoredPhase, toStoredPhase } from '../auction.mapper.js';
import type {
  ListFields,
  ListRow,
  RowDiff,
  RowUpdate,
  StoredListState,
} from '../domain/list-diff.js';
import type { PhaseModality } from '../domain/modality.js';
import { AuctionEntity, AuctionDocument } from '../schemas/auction.schema.js';
import { activeAuctionFilter } from '../utils/auction-filters.js';

/** What `ListApplier` hands the repository for one chunk of rows. */
export interface ChunkWrites {
  /** The diffs of the chunk's rows, by code, as `diffListRow` answered. */
  diffs: ReadonlyMap<string, Exclude<RowDiff, { kind: 'skip' }>>;
  runId: Types.ObjectId;
  now: Date;
}

/**
 * The auctions the list apply reads and writes (AR-08: the only file of the apply that touches
 * the model). Every write is idempotent: applying the same chunk twice, even at once, ends in the
 * same state (BR-004-07).
 */
@Injectable()
export class ListApplierRepository {
  constructor(@InjectModel(AuctionEntity.name) private readonly model: Model<AuctionDocument>) {}

  /** The stored state the diff needs, by code. A code not stored is absent from the map. */
  async findStates(codes: readonly string[]): Promise<Map<string, StoredListState>> {
    const docs = await this.model
      .find({ code: serverOperators({ $in: [...codes] }) })
      .select(
        'code title address appraisalPrice detailsUrl propertyType available currentPhase phases detailsCollectedAt',
      )
      .lean()
      .exec();
    return new Map(
      docs.map((doc) => {
        const phase = doc.currentPhase ? fromStoredPhase(doc.currentPhase) : null;
        const state: StoredListState = {
          title: doc.title ?? null,
          address: doc.address ?? {},
          appraisalPrice: fromDecimal128OrNull(doc.appraisalPrice),
          detailsUrl: doc.detailsUrl ?? null,
          propertyType: doc.propertyType ?? null,
          // A legacy document without the flag was available (the schema default).
          available: doc.available ?? true,
          modality: phase?.modality ?? null,
          minimumPrice: phase?.minimumPrice ?? null,
          phaseCount: doc.phases?.length ?? 0,
          detailsCollected: doc.detailsCollectedAt != null,
        };
        return [doc.code, state];
      }),
    );
  }

  /**
   * Writes one chunk, unordered. Every listed row is stamped with the run (`lastSeenRunId`,
   * `listSeenAt`), changed or not: that stamp, not a delete or a flag per row, is how absence is
   * read afterwards (BR-004-08). `updatedAt` moves only for a property that changed, so the
   * search order is not shuffled by a re-import.
   *
   * A write that fails throws (MongoBulkWriteError) and the apply stops before it marks anything
   * unavailable (BR-004-08); the writes that did land are harmless on the retry.
   */
  async applyChunk({ diffs, runId, now }: ChunkWrites): Promise<void> {
    const ops: AnyBulkWriteOperation<AuctionEntity>[] = [];
    const unchanged: string[] = [];
    const stamp = { lastSeenRunId: runId, listSeenAt: now };

    for (const [code, diff] of diffs) {
      if (diff.kind === 'unchanged') unchanged.push(code);
      else if (diff.kind === 'insert') ops.push(insertOp(diff.row, diff.modality, stamp, now));
      else ops.push(updateOp(code, diff, stamp, runId, now));
    }
    if (unchanged.length > 0) {
      ops.push({
        updateMany: {
          filter: { code: serverOperators({ $in: unchanged }) },
          update: { $set: stamp },
          timestamps: false,
        },
      });
    }
    if (ops.length === 0) return;
    await this.model.bulkWrite(ops, { ordered: false });
  }

  /**
   * The next codes of available properties the run's list did not contain, after `afterCode`
   * (BR-004-08). Paged by code so a pass always advances.
   */
  async findUnseenAvailable(
    runId: Types.ObjectId,
    afterCode: string | null,
    limit: number,
  ): Promise<string[]> {
    const docs = await this.model
      .find({
        available: true,
        lastSeenRunId: serverOperators({ $ne: runId }),
        ...(afterCode === null ? {} : { code: serverOperators({ $gt: afterCode }) }),
      })
      .select('code')
      .sort({ code: 1 })
      .limit(limit)
      .lean()
      .exec();
    return docs.map((doc) => doc.code);
  }

  /** Marks these codes unavailable, unless the run saw them since (BR-004-08, BR-004-17: kept). */
  async markUnavailable(runId: Types.ObjectId, codes: readonly string[], now: Date): Promise<void> {
    if (codes.length === 0) return;
    await this.model
      .updateMany(
        {
          code: serverOperators({ $in: [...codes] }),
          available: true,
          lastSeenRunId: serverOperators({ $ne: runId }),
        },
        { $set: { available: false, updatedAt: now } },
        { timestamps: false },
      )
      .exec();
  }

  /** Properties the run changed (a list field, or returned): BR-004-27's "changed". */
  countChanged(runId: Types.ObjectId): Promise<number> {
    return this.model.countDocuments({ lastChangedRunId: runId }).exec();
  }

  /** BR-004-27: how many properties are active at `now` (BR-004-16). */
  countActive(now: Date): Promise<number> {
    return this.model.countDocuments(activeAuctionFilter(now)).exec();
  }
}

type Stamp = { lastSeenRunId: Types.ObjectId; listSeenAt: Date };

function insertOp(
  row: ListRow,
  modality: PhaseModality,
  stamp: Stamp,
  now: Date,
): AnyBulkWriteOperation<AuctionEntity> {
  const phase = toStoredPhase({ modality, minimumPrice: row.minimumPrice, phaseDates: [] });
  return {
    updateOne: {
      filter: { code: row.code },
      // $setOnInsert: two processes inserting the same new property end with one document.
      update: {
        $setOnInsert: {
          code: row.code,
          title: row.title,
          address: row.address,
          appraisalPrice: toDecimal128OrNull(row.appraisalPrice),
          phases: [phase],
          currentPhase: phase,
          detailsUrl: row.detailsUrl,
          propertyType: row.propertyType,
          available: true,
          fulfilled: false,
          createdAt: now,
          updatedAt: now,
          ...stamp,
        },
      },
      upsert: true,
      timestamps: false,
    },
  };
}

function updateOp(
  code: string,
  diff: RowUpdate,
  stamp: Stamp,
  runId: Types.ObjectId,
  now: Date,
): AnyBulkWriteOperation<AuctionEntity> {
  const set: Record<string, unknown> = { ...stamp, ...fieldWrites(diff.fields) };
  const filter: Record<string, unknown> = { code };
  const update: Record<string, unknown> = { $set: set };

  if (diff.changed) {
    set.updatedAt = now;
    set.lastChangedRunId = runId;
  }
  if (diff.returned) set.available = true;

  if (diff.modalityChange) {
    const phase = toStoredPhase({
      modality: diff.modalityChange.to,
      minimumPrice: diff.modalityChange.price,
      phaseDates: [],
    });
    set.currentPhase = phase;
    update.$push = { phases: phase };
    // Guarded by the modality read: a second process that read the same state finds the phase
    // already appended and matches nothing, so a phase is never appended twice (BR-004-07).
    filter['currentPhase.modality'] = diff.modalityChange.from;
  } else if (diff.price) {
    const price = toDecimal128OrNull(diff.price.value);
    set['currentPhase.minimumPrice'] = price;
    // The last phase follows the list price, as the current one does (the scraper writes them
    // back together).
    if (diff.phaseCount > 0) set[`phases.${diff.phaseCount - 1}.minimumPrice`] = price;
  }

  return {
    updateOne: {
      filter,
      update,
      timestamps: false,
    },
  };
}

/** The list fields of an update as stored (money as Decimal128, AR-17). */
function fieldWrites(fields: Partial<ListFields>): Record<string, unknown> {
  const writes: Record<string, unknown> = {};
  if (fields.title !== undefined) writes.title = fields.title;
  if (fields.address !== undefined) writes.address = fields.address;
  if (fields.appraisalPrice !== undefined) {
    writes.appraisalPrice = toDecimal128OrNull(fields.appraisalPrice);
  }
  if (fields.detailsUrl !== undefined) writes.detailsUrl = fields.detailsUrl;
  if (fields.propertyType !== undefined) writes.propertyType = fields.propertyType;
  return writes;
}
