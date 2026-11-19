// SPEC-012 BR-012-22..BR-012-25, BR-012-27: the office's active-journey slots. SPEC-016 calls
// `reserve` when a journey starts (in the same transaction as the insert, in the order
// OwnerCounterRepository documents) and `release` when one ends, whatever the reason (a lost bid,
// a conductor's cancel: D-41).
//
//   - the count is one conditional update on `ownerCounters` (`value < limit` → `+1`), so
//     concurrent starts, including by different members of the same office, can never leave it
//     above the limit (BR-012-24, AR-15);
//   - the limit is the copy on the subscription in effect, read fresh on every call; zero when
//     none is in effect (BR-012-21), so a lapsed office starts nothing while its journeys in
//     progress continue (the counter is never reduced by a lapse or a downgrade, BR-012-18);
//   - a refusal is JOURNEY_LIMIT_REACHED with the counts only (BR-012-25, AR-40).
//
// BR-012-27: the self-advised investor's limit of 3 is not a plan. It is SPEC-016's, enforced as
// SPEC-011 defines, and never goes through here: asking for it is a programming error.
import { Injectable, Logger } from '@nestjs/common';
import type { ClientSession } from 'mongoose';
import type { AccessContext, ActingOwner } from '../access/access-context.js';
import { type CountedOwner, OwnerCounterRepository } from '../access/owner-counter.repository.js';
import { DomainError } from '../common/errors/domain-error.js';
import { effectiveJourneyLimit } from './domain/subscription-status.js';
import { SubscriptionsRepository } from './subscriptions.repository.js';

/** The counter of journeys in progress, per office (BR-012-22). */
export const ACTIVE_JOURNEYS_KEY = 'journeys.active';

export interface ReserveOptions {
  /** The owner chosen by `ctx.resolveActingOwner(...)`. */
  actingOwner: ActingOwner;
  /** SPEC-016: the transaction the journey insert runs in. */
  session?: ClientSession;
}

function assertOfficeOwner(ownerType: string): void {
  if (ownerType !== 'office') {
    throw new Error(
      'Journey slots belong to offices: the self-advised limit of 3 is not a plan (SPEC-012 ' +
        'BR-012-27, D-07) and is enforced by SPEC-016',
    );
  }
}

@Injectable()
export class JourneySlotsService {
  private readonly logger = new Logger(JourneySlotsService.name);

  constructor(
    private readonly subscriptions: SubscriptionsRepository,
    private readonly counters: OwnerCounterRepository,
  ) {}

  /**
   * Creates the zero counter if it is missing. SPEC-016 calls it BEFORE `startTransaction`, so the
   * transaction can see the counter (OwnerCounterRepository documents why).
   */
  async ensureCounter(ctx: AccessContext, options: { actingOwner: ActingOwner }): Promise<void> {
    assertOfficeOwner(options.actingOwner.owner.ownerType);
    await this.counters.ensureCounter(ctx, ACTIVE_JOURNEYS_KEY, options);
  }

  /**
   * BR-012-23, BR-012-24: takes one slot, or throws JOURNEY_LIMIT_REACHED { inProgress, limit }.
   * A read-only office is refused with OFFICE_READ_ONLY by the counter (BR-012-28).
   */
  async reserve(ctx: AccessContext, options: ReserveOptions): Promise<void> {
    const { actingOwner, session } = options;
    assertOfficeOwner(actingOwner.owner.ownerType);
    const limit = await this.limitOf(actingOwner.owner.ownerId);
    const acquired = await this.counters.tryAcquire(ctx, ACTIVE_JOURNEYS_KEY, limit, {
      actingOwner,
      session,
    });
    if (acquired) return;
    // BR-012-25: the member is told the counts and the two ways forward (the interface's text).
    const inProgress = await this.counters.readValue(ctx, ACTIVE_JOURNEYS_KEY, { actingOwner });
    throw new DomainError('JOURNEY_LIMIT_REACHED', { inProgress, limit });
  }

  /**
   * BR-012-22: gives a slot back when a journey ends for any reason (D-41). The caller releases
   * once per journey, with the conditional close, in the same transaction
   * (OwnerCounterRepository.release documents it).
   */
  async release(
    ctx: AccessContext,
    owner: CountedOwner,
    options: { session?: ClientSession } = {},
  ): Promise<boolean> {
    assertOfficeOwner(owner.ownerType);
    return this.counters.release(ctx, owner, ACTIVE_JOURNEYS_KEY, options);
  }

  /**
   * BR-012-26: the office's in-progress count, for the plan page ("4 of 5 journeys in progress").
   * A read: it works for a read-only office too (D-47).
   */
  async inProgress(ctx: AccessContext, options: { actingOwner: ActingOwner }): Promise<number> {
    assertOfficeOwner(options.actingOwner.owner.ownerType);
    return this.counters.readValue(ctx, ACTIVE_JOURNEYS_KEY, options);
  }

  /**
   * BR-012-22: gives a slot back when a journey ends for a reason NO member of the office drives,
   * or in an office that its members can no longer write to: a lost bid (D-13), an ending by a
   * schedule or by the investor, and every ending in an office that is read-only or lapsed (a
   * member's `release` is refused there with OFFICE_READ_ONLY, but the journey ended all the
   * same, and its slot must free). The owner is the one the ended journey carries, never a request
   * value (AR-12, `OwnerCounterRepository.releaseByJob`). Same once-per-journey rule as `release`.
   */
  async releaseForSystem(
    owner: CountedOwner,
    options: { session?: ClientSession } = {},
  ): Promise<boolean> {
    assertOfficeOwner(owner.ownerType);
    return this.counters.releaseByJob(owner, ACTIVE_JOURNEYS_KEY, options);
  }

  /**
   * BR-012-22, BR-012-24: repairs drift. SPEC-016's daily job counts the journeys really in
   * progress per office and calls this with the count; if the counter says otherwise it is set to
   * the truth (a crash between a journey's write and its slot, a manual correction). Logs the
   * office id and the two counts only (SC-15). Answers whether it changed anything.
   */
  async reconcileCount(owner: CountedOwner, actualInProgress: number): Promise<boolean> {
    assertOfficeOwner(owner.ownerType);
    const replaced = await this.counters.setCountByJob(
      owner,
      ACTIVE_JOURNEYS_KEY,
      actualInProgress,
    );
    if (replaced === null) return false;
    this.logger.warn(
      `Journey count of office ${String(owner.ownerId)} repaired: ${replaced} stored, ${actualInProgress} in progress`,
    );
    return true;
  }

  /** BR-012-21: the copy on the subscription in effect, 0 when there is none. Always read fresh. */
  private async limitOf(officeId: string): Promise<number> {
    const subscription = await this.subscriptions.findInEffectByOffice(officeId);
    return subscription === null ? 0 : effectiveJourneyLimit(subscription);
  }
}
