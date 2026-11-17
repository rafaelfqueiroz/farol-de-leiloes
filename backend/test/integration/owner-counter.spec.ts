// SPEC-002 BR-002-13 / AR-15 / TS-02: the atomic limit primitive against a real MongoDB. Concurrent
// acquires one below the limit give exactly one success, including the race on the very first
// acquire (two requests creating the counter at once); a release never goes below zero; and an
// acquire inside an aborted transaction counts nothing (SPEC-016 runs it with the journey insert).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Connection, Model } from 'mongoose';
import { OwnerCounterRepository } from '../../src/access/owner-counter.repository.js';
import { OwnerCountersModule } from '../../src/access/owner-counters.module.js';
import { OwnerCounterEntity } from '../../src/access/schemas/owner-counter.schema.js';
import type { OfficePlanState } from '../../src/access/sources/office-plan.source.js';
import { DomainError } from '../../src/common/errors/domain-error.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { anAccessContext } from '../fakes/fake-access-sources.js';
import { useTestDatabase } from '../support/test-database.js';

const OFFICE = '64b7f00000000000000a0a0a';
const OTHER_OFFICE = '64b7f00000000000000b0b0b';
const WRITABLE: OfficePlanState = { advisorPlanActive: true, readOnly: false, entitlements: [] };

describe('OwnerCounterRepository (integration, SPEC-002 BR-002-13)', () => {
  const db = useTestDatabase();
  let moduleRef: TestingModule;
  let counters: OwnerCounterRepository;
  let model: Model<OwnerCounterEntity>;

  const member = (plan: OfficePlanState = WRITABLE, officeId = OFFICE) =>
    anAccessContext('64b7f0000000000000000a01', {
      memberships: [{ officeId }],
      officePlans: { [officeId]: plan },
    });
  const valueOf = async (key: string, officeId = OFFICE) =>
    (
      await model
        .findOne({ ownerId: { $eq: officeId }, key: { $eq: key } })
        .lean()
        .exec()
    )?.value ?? null;

  beforeAll(async () => {
    applyMongooseDefaults();
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(db.uri), OwnerCountersModule],
    }).compile();
    counters = moduleRef.get(OwnerCounterRepository);
    model = moduleRef.get(getModelToken(OwnerCounterEntity.name));
    await model.syncIndexes(); // the unique { ownerType, ownerId, key } the race relies on
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('BR-002-13: the very first acquires, all at once against limit 1, give exactly one success', async () => {
    const ctx = await member();

    const results = await Promise.all(
      Array.from({ length: 20 }, () => counters.tryAcquire(ctx, 'first-race', 1)),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await valueOf('first-race')).toBe(1);
  });

  it('BR-002-13 / AR-15: N parallel acquires at limit − 1 give exactly one success', async () => {
    const ctx = await member();
    for (let n = 0; n < 4; n += 1) {
      expect(await counters.tryAcquire(ctx, 'journeys', 5)).toBe(true);
    }

    const results = await Promise.all(
      Array.from({ length: 12 }, () => counters.tryAcquire(ctx, 'journeys', 5)),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await valueOf('journeys')).toBe(5);
    expect(await counters.tryAcquire(ctx, 'journeys', 5)).toBe(false);
  });

  it('counts per owner: another office’s counter is its own', async () => {
    const ctx = await member(WRITABLE, OTHER_OFFICE);

    expect(await counters.tryAcquire(ctx, 'journeys', 5)).toBe(true);
    expect(await valueOf('journeys', OTHER_OFFICE)).toBe(1);
    expect(await valueOf('journeys')).toBe(5);
  });

  it('release gives a slot back and never goes below zero', async () => {
    const ctx = await member();
    const owner = { ownerType: 'office' as const, ownerId: OFFICE };
    expect(await counters.tryAcquire(ctx, 'released', 3)).toBe(true);

    expect(await counters.release(ctx, owner, 'released')).toBe(true);
    expect(await counters.release(ctx, owner, 'released')).toBe(false);
    expect(await valueOf('released')).toBe(0);
  });

  it('AR-15: an acquire in an aborted transaction counts nothing', async () => {
    const ctx = await member();
    const connection = moduleRef.get<Connection>(getConnectionToken());
    expect(await counters.tryAcquire(ctx, 'transactional', 2)).toBe(true);

    const session = await connection.startSession();
    try {
      session.startTransaction();
      expect(await counters.tryAcquire(ctx, 'transactional', 2, { session })).toBe(true);
      await session.abortTransaction();
    } finally {
      await session.endSession();
    }

    expect(await valueOf('transactional')).toBe(1);
  });

  it('refuses a zero or invalid limit, a read-only owner and an owner the request cannot write', async () => {
    const ctx = await member();

    expect(await counters.tryAcquire(ctx, 'none-allowed', 0)).toBe(false);
    await expect(counters.tryAcquire(ctx, 'bad', 1.5)).rejects.toThrow(/whole number/);
    await expect(counters.tryAcquire(ctx, 'bad', -1)).rejects.toThrow(/whole number/);
    const readOnly = await member({ ...WRITABLE, readOnly: true });
    await expect(counters.tryAcquire(readOnly, 'journeys', 9)).rejects.toEqual(
      new DomainError('OFFICE_READ_ONLY'),
    );
    await expect(
      counters.release(ctx, { ownerType: 'office', ownerId: OTHER_OFFICE }, 'journeys'),
    ).rejects.toThrow(/may write to/);
    const other = await member();
    await expect(
      counters.tryAcquire(ctx, 'journeys', 9, { actingOwner: other.resolveActingOwner() }),
    ).rejects.toThrow(/another request/);
  });
});
