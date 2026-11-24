import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  brasiliaDayStartBefore,
  refreshDueBefore,
  type QueueCandidate,
} from '../domain/enrichment-queue.js';
import { serverOperators } from '../../common/mongo/query-safety.js';
import { fromStoredRound, toStoredRound } from '../auction.mapper.js';
import type { ExpenseRule, Occupancy, PaymentMethod } from '../domain/detail-data.js';
import { isActive } from '../domain/active.js';
import type { PhaseModality } from '../domain/modality.js';
import type { Round } from '../domain/rounds.js';
import {
  AuctionEntity,
  AuctionDocument,
  type AuctionFile,
  type StoredDocumentVersion,
} from '../schemas/auction.schema.js';
import { activeAuctionFilter } from '../utils/auction-filters.js';

/** What the collection of one property reads of it (BR-004-11, BR-004-30). */
export interface StoredForCollection {
  code: string;
  detailsUrl: string | null;
  available: boolean;
  /** The list's modality: what the page's dates are read as. Null when the property has none. */
  modality: PhaseModality | null;
  /** Phases stored: the legacy mirror of the details is written into the last one. */
  phaseCount: number;
  rounds: Round[];
  paymentMethods: PaymentMethod[] | null;
  expenseRules: ExpenseRule[] | null;
  propertyType: string | null;
  occupancy: Occupancy | null;
  photos: AuctionFile[];
  documentVersions: StoredDocumentVersion[];
  detailsFailures: number;
  /** The round recorded when the property was last looked at (undefined = never). */
  currentRoundLabel: string | null | undefined;
  /** Null = this property's page was never collected (or was dropped when it came back). */
  detailsCollectedAt: Date | null;
}

/** What a collection writes (BR-004-11, BR-004-22): only what the page stated is present. */
export interface CollectionWrite {
  now: Date;
  description?: string;
  propertyType?: string;
  occupancy?: Occupancy;
  /** The rounds with their prices and the label of the one current at `now`. */
  rounds?: Round[];
  currentRoundLabel?: string | null;
  paymentMethods?: PaymentMethod[];
  expenseRules?: ExpenseRule[];
  /** The round end dates, mirrored into the last phase for readers of `phases` (the public API). */
  phaseDates?: Date[];
  /** The phases the write was computed against: the mirror applies only if it is still that many. */
  phaseCount: number;
  photos?: AuctionFile[];
  matricula?: AuctionFile;
  edital?: AuctionFile;
  newVersions: StoredDocumentVersion[];
  /** `updatedAt` moves (a change entry was recorded, or the property is newly complete). */
  touch: boolean;
}

/** What the clock reads of a property (BR-004-13, BR-004-26). */
export interface ClockCandidate {
  code: string;
  rounds: Round[];
  /** string = a round was current, null = none was, undefined = never recorded. */
  currentRoundLabel: string | null | undefined;
}

/**
 * The only file of the detail collection that touches the auction model (AR-08). Every write is
 * by property number and idempotent: the same collection applied twice ends in the same state.
 */
@Injectable()
export class EnrichmentRepository {
  constructor(@InjectModel(AuctionEntity.name) private readonly model: Model<AuctionDocument>) {}

  /**
   * The properties that may be due, tier by tier, each bounded by `limit` (BR-004-18, BR-004-19):
   * never collected or returned, changed in this run, due for a refresh. The queue (domain) orders
   * and filters them again; these queries only keep a tier from drowning the budget in properties
   * that are waiting out a back-off or were collected today.
   */
  async findCandidates(input: {
    runId: string;
    now: Date;
    limit: number;
    maxStalenessDays: number;
  }): Promise<QueueCandidate[]> {
    const { runId, now, limit, maxStalenessDays } = input;
    const base = {
      available: true,
      detailsUrl: serverOperators({ $exists: true, $ne: null }),
    };
    const notWaiting = {
      $or: [{ detailsRetryAfter: null }, { detailsRetryAfter: serverOperators({ $lte: now }) }],
    };
    const notToday = {
      detailsCollectedAt: serverOperators({ $lt: brasiliaDayStartBefore(now, 0) }),
    };
    const tiers: { filter: Record<string, unknown>; sort: Record<string, 1> }[] = [
      {
        filter: {
          $and: [base, notWaiting, { $or: [{ detailsCollectedAt: null }, { fulfilled: false }] }],
        },
        sort: { code: 1 },
      },
      {
        filter: {
          $and: [
            base,
            notWaiting,
            { fulfilled: true },
            { lastChangedRunId: new Types.ObjectId(runId) },
            notToday,
          ],
        },
        sort: { code: 1 },
      },
      {
        filter: {
          $and: [
            base,
            notWaiting,
            { fulfilled: true },
            activeAuctionFilter(now),
            {
              // Due by age, or a failed collection whose back-off is over (a retry, BR-004-21).
              $or: [
                {
                  detailsCollectedAt: serverOperators({
                    $lt: refreshDueBefore(now, maxStalenessDays),
                  }),
                },
                { detailsFailures: serverOperators({ $gt: 0 }) },
              ],
            },
          ],
        },
        sort: { detailsCollectedAt: 1, code: 1 },
      },
    ];
    const found: QueueCandidate[] = [];
    for (const { filter, sort } of tiers) {
      const docs = await this.model
        .find(filter)
        .select(
          'code available detailsUrl fulfilled detailsCollectedAt lastChangedRunId detailsRetryAfter detailsFailures rounds',
        )
        .sort(sort)
        .limit(limit)
        .lean()
        .exec();
      for (const doc of docs) {
        found.push({
          code: doc.code,
          available: doc.available ?? true,
          active: isActive(
            { available: doc.available ?? true, rounds: (doc.rounds ?? []).map(fromStoredRound) },
            now,
          ),
          hasDetailsUrl: typeof doc.detailsUrl === 'string' && doc.detailsUrl !== '',
          fulfilled: doc.fulfilled ?? false,
          detailsCollectedAt: doc.detailsCollectedAt ?? null,
          lastChangedRunId: doc.lastChangedRunId?.toString() ?? null,
          detailsRetryAfter: doc.detailsRetryAfter ?? null,
          detailsFailures: doc.detailsFailures ?? 0,
        });
      }
    }
    return found;
  }

  async findForCollection(code: string): Promise<StoredForCollection | null> {
    const doc = await this.model
      .findOne({ code: { $eq: code } })
      .select(
        'code detailsUrl available currentPhase phases rounds paymentMethods expenseRules propertyType occupancy photos documentVersions detailsFailures detailsCollectedAt currentRoundLabel',
      )
      .lean()
      .exec();
    if (doc === null) return null;
    return {
      code: doc.code,
      detailsUrl: doc.detailsUrl ?? null,
      available: doc.available ?? true,
      modality: doc.currentPhase?.modality ?? null,
      phaseCount: doc.phases?.length ?? 0,
      rounds: (doc.rounds ?? []).map(fromStoredRound),
      paymentMethods: doc.paymentMethods ?? null,
      expenseRules: doc.expenseRules ?? null,
      propertyType: doc.propertyType ?? null,
      occupancy: doc.occupancy ?? null,
      photos: doc.photos ?? [],
      documentVersions: doc.documentVersions ?? [],
      detailsFailures: doc.detailsFailures ?? 0,
      detailsCollectedAt: doc.detailsCollectedAt ?? null,
      currentRoundLabel: doc.currentRoundLabel,
    };
  }

  /**
   * One atomic update: the fields the page stated, the copies, the new versions, the collection
   * stamp and the reset of the failure counters. A field the page did not state is not in `$set`
   * at all (unknown never replaces known, BR-004-15). The legacy phase mirror (the public API
   * still reads `phases[].phaseDates`) is a second, guarded write.
   */
  async applyCollection(code: string, write: CollectionWrite): Promise<void> {
    const set: Record<string, unknown> = {
      detailsCollectedAt: write.now,
      fulfilled: true,
      detailsFailures: 0,
      detailsRetryAfter: null,
    };
    if (write.description !== undefined) set.description = write.description;
    if (write.propertyType !== undefined) set.propertyType = write.propertyType;
    if (write.occupancy !== undefined) set.occupancy = write.occupancy;
    if (write.rounds !== undefined) set.rounds = write.rounds.map(toStoredRound);
    if (write.currentRoundLabel !== undefined) set.currentRoundLabel = write.currentRoundLabel;
    if (write.paymentMethods !== undefined) set.paymentMethods = write.paymentMethods;
    if (write.expenseRules !== undefined) set.expenseRules = write.expenseRules;
    if (write.photos !== undefined) {
      set.photos = write.photos;
      const first = write.photos[0];
      if (first !== undefined) set.image = first;
    }
    if (write.matricula !== undefined) set.matricula = write.matricula;
    if (write.edital !== undefined) set.edital = write.edital;
    if (write.touch) set.updatedAt = write.now;

    await this.model
      .updateOne(
        { code: { $eq: code } },
        {
          $set: set,
          ...(write.newVersions.length > 0
            ? { $push: { documentVersions: { $each: write.newVersions } } }
            : {}),
        },
        { timestamps: false },
      )
      .exec();

    if (write.phaseDates !== undefined && write.phaseCount > 0) {
      const dates = write.phaseDates;
      const mirror: Record<string, unknown> = {
        'currentPhase.phaseDates': dates,
        [`phases.${write.phaseCount - 1}.phaseDates`]: dates,
      };
      if (write.paymentMethods !== undefined) {
        mirror['currentPhase.paymentMethods'] = write.paymentMethods;
        mirror[`phases.${write.phaseCount - 1}.paymentMethods`] = write.paymentMethods;
      }
      if (write.expenseRules !== undefined) {
        mirror['currentPhase.expenseRules'] = write.expenseRules;
        mirror[`phases.${write.phaseCount - 1}.expenseRules`] = write.expenseRules;
      }
      // Guarded by the phase count that was read: the list apply may have appended a phase since.
      await this.model
        .updateOne(
          { code: { $eq: code }, phases: serverOperators({ $size: write.phaseCount }) },
          { $set: mirror },
          { timestamps: false },
        )
        .exec();
    }
  }

  /**
   * BR-004-30: a stored version was compared with Caixa's file again and is the same: its check
   * date moves (and the publication date Caixa shows now, when it shows one). No new version.
   */
  async markVersionChecked(
    code: string,
    check: { kind: 'MATRICULA' | 'EDITAL'; contentHash: string; publishedAt: Date | null },
    now: Date,
  ): Promise<void> {
    await this.model
      .updateOne(
        { code: { $eq: code } },
        {
          $set: {
            'documentVersions.$[version].checkedAt': now,
            ...(check.publishedAt === null
              ? {}
              : { 'documentVersions.$[version].publishedAt': check.publishedAt }),
          },
        },
        {
          arrayFilters: [{ 'version.kind': check.kind, 'version.contentHash': check.contentHash }],
          timestamps: false,
        },
      )
      .exec();
  }

  /** BR-004-21: the page failed. Nothing else about the property changes. */
  async recordFailure(code: string, failures: number, retryAfter: Date): Promise<void> {
    await this.model
      .updateOne(
        { code: { $eq: code } },
        { $set: { detailsFailures: failures, detailsRetryAfter: retryAfter } },
        { timestamps: false },
      )
      .exec();
  }

  /**
   * Available properties with at least one round whose date has passed at `now`, after
   * `afterCode`, by number: the only ones whose current round can have moved (BR-004-13).
   */
  async findClockCandidates(
    now: Date,
    afterCode: string | null,
    limit: number,
  ): Promise<ClockCandidate[]> {
    const docs = await this.model
      .find({
        available: true,
        'rounds.date': serverOperators({ $lte: now }),
        ...(afterCode === null ? {} : { code: serverOperators({ $gt: afterCode }) }),
      })
      .select('code rounds currentRoundLabel')
      .sort({ code: 1 })
      .limit(limit)
      .lean()
      .exec();
    return docs.map((doc) => ({
      code: doc.code,
      rounds: (doc.rounds ?? []).map(fromStoredRound),
      currentRoundLabel: doc.currentRoundLabel,
    }));
  }

  /**
   * Records the round that is current now, only if the property still holds what the clock read
   * (`expected`): a collection that moved it in between wins and the next day looks again.
   */
  async setCurrentRoundLabel(
    code: string,
    expected: string | null | undefined,
    label: string | null,
  ): Promise<void> {
    const guard =
      expected === undefined
        ? { currentRoundLabel: serverOperators({ $exists: false }) }
        : { currentRoundLabel: expected };
    await this.model
      .updateOne(
        { code: { $eq: code }, ...guard },
        { $set: { currentRoundLabel: label } },
        { timestamps: false },
      )
      .exec();
  }
}
