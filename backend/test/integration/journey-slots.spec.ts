// SPEC-012 BR-012-22..BR-012-25, TS-02: the active-journey slots against a real MongoDB, on the
// indexes migration 0007 builds (autoIndex off, as in the deploy). Twenty starts racing for one
// free slot give exactly one success, whichever member starts them; a downgrade below the count
// blocks starts until the count drops; a lapse sets the limit to 0 without touching the count.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Connection, type Model, Types } from 'mongoose';
import type { AccessContext } from '../../src/access/access-context.js';
import { OwnerCounterRepository } from '../../src/access/owner-counter.repository.js';
import { OwnerCountersModule } from '../../src/access/owner-counters.module.js';
import { OwnerCounterEntity } from '../../src/access/schemas/owner-counter.schema.js';
import type { OfficePlanState } from '../../src/access/sources/office-plan.source.js';
import { DomainError } from '../../src/common/errors/domain-error.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { createBillingIndexes } from '../../src/migrations/0007-billing-indexes.migration.js';
import {
  ACTIVE_JOURNEYS_KEY,
  JourneySlotsService,
} from '../../src/subscriptions/journey-slots.service.js';
import type { SubscriptionStatus } from '../../src/subscriptions/domain/subscription-status.js';
import {
  SubscriptionEntity,
  SubscriptionSchema,
  type SubscriptionDocument,
} from '../../src/subscriptions/schemas/subscription.schema.js';
import { SubscriptionsRepository } from '../../src/subscriptions/subscriptions.repository.js';
import { anAccessContext } from '../fakes/fake-access-sources.js';
import { useTestDatabase } from '../support/test-database.js';

const OFFICE = '64b7f0000000000000000c01';
const OTHER_OFFICE = '64b7f0000000000000000c02';
const PLAN = '64b7f0000000000000000a05';
const WRITABLE: OfficePlanState = { advisorPlanActive: true, readOnly: false, entitlements: [] };

describe('JourneySlotsService (integration, SPEC-012)', () => {
  const db = useTestDatabase();
  let moduleRef: TestingModule;
  let slots: JourneySlotsService;
  let counters: Model<OwnerCounterEntity>;
  let subscriptions: Model<SubscriptionDocument>;

  const member = (
    accountId: string,
    officeId = OFFICE,
    plan: OfficePlanState = WRITABLE,
  ): Promise<AccessContext> =>
    anAccessContext(accountId, {
      memberships: [{ officeId }],
      officePlans: { [officeId]: plan },
    });
  const reserve = async (ctx: AccessContext) => {
    try {
      await slots.reserve(ctx, { actingOwner: ctx.resolveActingOwner() });
      return 'reserved';
    } catch (error) {
      if (error instanceof DomainError) return error.code;
      throw error;
    }
  };
  const countOf = async (officeId = OFFICE) =>
    (
      await counters
        .findOne({ ownerId: { $eq: officeId }, key: { $eq: ACTIVE_JOURNEYS_KEY } })
        .lean()
        .exec()
    )?.value ?? 0;
  const subscribe = (status: SubscriptionStatus, limit: number, officeId = OFFICE) =>
    subscriptions.collection.insertOne({
      officeId: new Types.ObjectId(officeId),
      buyerUserId: new Types.ObjectId(),
      planId: new Types.ObjectId(PLAN),
      planCode: 'escritorio',
      activeJourneyLimit: limit,
      status,
      cancelAtPeriodEnd: false,
    });

  beforeAll(async () => {
    applyMongooseDefaults();
    moduleRef = await Test.createTestingModule({
      imports: [
        // autoIndex off: the unique counter below is the one migration 0007 builds.
        MongooseModule.forRoot(db.uri, { autoIndex: false }),
        MongooseModule.forFeature([{ name: SubscriptionEntity.name, schema: SubscriptionSchema }]),
        OwnerCountersModule,
      ],
      providers: [SubscriptionsRepository, JourneySlotsService],
    }).compile();
    slots = moduleRef.get(JourneySlotsService);
    counters = moduleRef.get(getModelToken(OwnerCounterEntity.name));
    subscriptions = moduleRef.get(getModelToken(SubscriptionEntity.name));
    const connection = moduleRef.get<Connection>(getConnectionToken());
    if (!connection.db) throw new Error('connection has no db');
    await createBillingIndexes(connection.db);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await counters.collection.deleteMany({});
    await subscriptions.collection.deleteMany({});
  });

  it('BR-012-24: 20 starts racing for the one free slot give exactly one success', async () => {
    await subscribe('ACTIVE', 5);
    const ctx = await member('64b7f0000000000000000b01');
    for (let n = 0; n < 4; n += 1) expect(await reserve(ctx)).toBe('reserved');

    const results = await Promise.all(Array.from({ length: 20 }, () => reserve(ctx)));

    expect(results.filter((result) => result === 'reserved')).toHaveLength(1);
    expect(results.filter((result) => result === 'JOURNEY_LIMIT_REACHED')).toHaveLength(19);
    expect(await countOf()).toBe(5);
  });

  it('BR-012-24: the very first starts, creating the counter at the same moment, still give exactly one', async () => {
    await subscribe('ACTIVE', 1);
    const ctx = await member('64b7f0000000000000000b01');

    const results = await Promise.all(Array.from({ length: 20 }, () => reserve(ctx)));

    expect(results.filter((result) => result === 'reserved')).toHaveLength(1);
    expect(await countOf()).toBe(1);
    expect(await counters.countDocuments({ ownerId: { $eq: OFFICE } }).exec()).toBe(1);
  });

  it('BR-012-24, RF-CON-18: members of the same office share the count: two members, one free slot, one start', async () => {
    await subscribe('ACTIVE', 1);
    const contexts = await Promise.all(
      ['64b7f0000000000000000b01', '64b7f0000000000000000b02'].map((id) => member(id)),
    );

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, n) => reserve(contexts[n % 2] as AccessContext)),
    );

    expect(results.filter((result) => result === 'reserved')).toHaveLength(1);
  });

  it('BR-012-22: one office never uses another office slots', async () => {
    await subscribe('ACTIVE', 1, OFFICE);
    await subscribe('ACTIVE', 1, OTHER_OFFICE);

    expect(await reserve(await member('64b7f0000000000000000b01', OFFICE))).toBe('reserved');
    expect(await reserve(await member('64b7f0000000000000000b02', OTHER_OFFICE))).toBe('reserved');
    expect(await reserve(await member('64b7f0000000000000000b01', OFFICE))).toBe(
      'JOURNEY_LIMIT_REACHED',
    );
  });

  it('BR-012-25: the refusal carries the counts only: "2 of 2"', async () => {
    await subscribe('ACTIVE', 2);
    const ctx = await member('64b7f0000000000000000b01');
    await reserve(ctx);
    await reserve(ctx);

    const error = await slots
      .reserve(ctx, { actingOwner: ctx.resolveActingOwner() })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: 'JOURNEY_LIMIT_REACHED',
      context: { inProgress: 2, limit: 2 },
    });
  });

  it('BR-012-18: a downgrade below the count blocks starts until the count drops below the new limit', async () => {
    await subscribe('ACTIVE', 2);
    const ctx = await member('64b7f0000000000000000b01');
    await counters.collection.insertOne({
      ownerType: 'office',
      ownerId: new Types.ObjectId(OFFICE),
      key: ACTIVE_JOURNEYS_KEY,
      value: 4,
    });
    const owner = { ownerType: 'office', ownerId: OFFICE } as const;

    expect(await reserve(ctx)).toBe('JOURNEY_LIMIT_REACHED');
    await slots.release(ctx, owner); // 3
    await slots.release(ctx, owner); // 2
    expect(await reserve(ctx)).toBe('JOURNEY_LIMIT_REACHED');
    await slots.release(ctx, owner); // 1
    expect(await reserve(ctx)).toBe('reserved');
    expect(await countOf()).toBe(2);
  });

  it('BR-012-21: after the lapse the limit is 0, whatever the count; the journeys in progress are untouched', async () => {
    await subscribe('LAPSED', 5);
    const ctx = await member('64b7f0000000000000000b01');
    await counters.collection.insertOne({
      ownerType: 'office',
      ownerId: new Types.ObjectId(OFFICE),
      key: ACTIVE_JOURNEYS_KEY,
      value: 3,
    });

    const error = await slots
      .reserve(ctx, { actingOwner: ctx.resolveActingOwner() })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: 'JOURNEY_LIMIT_REACHED',
      context: { inProgress: 3, limit: 0 },
    });
    expect(await countOf()).toBe(3);
  });

  it('D-41: releasing after the cancel frees a slot, and a release never goes below zero', async () => {
    await subscribe('LAPSED', 5);
    const ctx = await member('64b7f0000000000000000b01');
    await counters.collection.insertOne({
      ownerType: 'office',
      ownerId: new Types.ObjectId(OFFICE),
      key: ACTIVE_JOURNEYS_KEY,
      value: 1,
    });
    const owner = { ownerType: 'office', ownerId: new Types.ObjectId(OFFICE) } as const;

    expect(await slots.release(ctx, owner)).toBe(true);
    expect(await slots.release(ctx, owner)).toBe(false);

    expect(await countOf()).toBe(0);
  });

  it('BR-012-16: an upgrade the sync stored is seen by the very next start', async () => {
    await subscribe('ACTIVE', 1);
    const ctx = await member('64b7f0000000000000000b01');
    expect(await reserve(ctx)).toBe('reserved');
    expect(await reserve(ctx)).toBe('JOURNEY_LIMIT_REACHED');

    await subscriptions.collection.updateOne({}, { $set: { activeJourneyLimit: 3 } });

    expect(await reserve(ctx)).toBe('reserved');
  });

  it('BR-012-26: the in-progress count reads 0 before any start and the count after', async () => {
    await subscribe('ACTIVE', 3);
    const ctx = await member('64b7f0000000000000000b01');
    const acting = ctx.resolveActingOwner();
    expect(await slots.inProgress(ctx, { actingOwner: acting })).toBe(0);

    await reserve(ctx);

    expect(await slots.inProgress(ctx, { actingOwner: acting })).toBe(1);
  });

  it('F6, D-13: a lost bid frees its slot through the system path, with the owner the journey stores (an ObjectId), never below zero', async () => {
    await subscribe('ACTIVE', 3);
    await counters.collection.insertOne({
      ownerType: 'office',
      ownerId: new Types.ObjectId(OFFICE),
      key: ACTIVE_JOURNEYS_KEY,
      value: 1,
    });
    const owner = { ownerType: 'office', ownerId: new Types.ObjectId(OFFICE) } as const;

    expect(await slots.releaseForSystem(owner)).toBe(true);
    expect(await slots.releaseForSystem(owner)).toBe(false);

    expect(await countOf()).toBe(0);
  });

  it('F6, BR-012-28: a READ-ONLY lapsed office still gets its slot back from the system path, where a member’s release is refused', async () => {
    await subscribe('LAPSED', 5);
    await counters.collection.insertOne({
      ownerType: 'office',
      ownerId: new Types.ObjectId(OFFICE),
      key: ACTIVE_JOURNEYS_KEY,
      value: 2,
    });
    const readOnly = await member('64b7f0000000000000000b01', OFFICE, {
      advisorPlanActive: true,
      readOnly: true,
      entitlements: [],
    });
    const owner = { ownerType: 'office', ownerId: OFFICE } as const;
    await expect(slots.release(readOnly, owner)).rejects.toThrow('A slot is released only');

    expect(await slots.releaseForSystem(owner)).toBe(true);

    expect(await countOf()).toBe(1);
  });

  it('F6: only the office’s own counter is lowered by the system path', async () => {
    await subscribe('ACTIVE', 3, OFFICE);
    await subscribe('ACTIVE', 3, OTHER_OFFICE);
    for (const officeId of [OFFICE, OTHER_OFFICE]) {
      await counters.collection.insertOne({
        ownerType: 'office',
        ownerId: new Types.ObjectId(officeId),
        key: ACTIVE_JOURNEYS_KEY,
        value: 2,
      });
    }

    await slots.releaseForSystem({ ownerType: 'office', ownerId: OFFICE });

    expect(await countOf(OFFICE)).toBe(1);
    expect(await countOf(OTHER_OFFICE)).toBe(2);
  });

  it('F6: the drift job sets a wrong counter to the truth, creates a missing one, and leaves a right one alone', async () => {
    const owner = { ownerType: 'office', ownerId: OFFICE } as const;
    await counters.collection.insertOne({
      ownerType: 'office',
      ownerId: new Types.ObjectId(OFFICE),
      key: ACTIVE_JOURNEYS_KEY,
      value: 7,
    });

    expect(await slots.reconcileCount(owner, 4)).toBe(true);
    expect(await countOf()).toBe(4);
    expect(await slots.reconcileCount(owner, 4)).toBe(false);
    expect(await countOf()).toBe(4);

    expect(await slots.reconcileCount({ ownerType: 'office', ownerId: OTHER_OFFICE }, 3)).toBe(
      true,
    );
    expect(await countOf(OTHER_OFFICE)).toBe(3);
    expect(await counters.countDocuments({ ownerId: { $eq: OTHER_OFFICE } }).exec()).toBe(1);
  });

  it('F6: the drift job racing twenty repairs of the same office still leaves one counter holding the truth', async () => {
    const owner = { ownerType: 'office', ownerId: OFFICE } as const;

    await Promise.all(Array.from({ length: 20 }, () => slots.reconcileCount(owner, 2)));

    expect(await countOf()).toBe(2);
    expect(await counters.countDocuments({ ownerId: { $eq: OFFICE } }).exec()).toBe(1);
  });

  it('keeps the repository for SPEC-016 wired: the counters module exports it', () => {
    expect(moduleRef.get(OwnerCounterRepository)).toBeInstanceOf(OwnerCounterRepository);
  });
});
