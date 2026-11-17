// SPEC-002 AR-12 / TS-02: OwnerScopedRepository against a real MongoDB (Testcontainers), through
// the PROBE repository of the isolation suite (test/isolation/support/probe.module.ts). The API
// behaviour is proven in test/isolation/probe.isolation.spec.ts; this spec holds the repository's
// own guarantees that no route can reach: filters cannot widen the owner condition, payloads never
// name an owner, updates never move one, and an acting owner belongs to its own request.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import mongoose, { type Model, Schema } from 'mongoose';
import { OwnerScopedRepository } from '../../src/access/owner-scoped.repository.js';
import type { OfficePlanState } from '../../src/access/sources/office-plan.source.js';
import { DomainError } from '../../src/common/errors/domain-error.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import {
  ProbeEntity,
  ProbeModule,
  type ProbeRecord,
  ProbeRepository,
} from '../isolation/support/probe.module.js';
import { anAccessContext, type FakeRelationships } from '../fakes/fake-access-sources.js';
import { useTestDatabase } from '../support/test-database.js';

const OFFICE_A = '64b7f00000000000000a0a0a';
const OFFICE_B = '64b7f00000000000000b0b0b';
const WRITABLE: OfficePlanState = { advisorPlanActive: true, readOnly: false, entitlements: [] };
const READ_ONLY: OfficePlanState = { ...WRITABLE, readOnly: true };

function memberOf(
  offices: Record<string, OfficePlanState>,
  extra: FakeRelationships = {},
): FakeRelationships {
  return {
    memberships: Object.keys(offices).map((officeId) => ({ officeId })),
    officePlans: offices,
    ...extra,
  };
}

describe('OwnerScopedRepository (integration, SPEC-002 AR-12)', () => {
  const db = useTestDatabase();
  let moduleRef: TestingModule;
  let probes: ProbeRepository;
  let model: Model<ProbeEntity>;
  let aRecord: ProbeRecord;
  let bRecord: ProbeRecord;

  const ctxA = () =>
    anAccessContext('64b7f0000000000000000a01', memberOf({ [OFFICE_A]: WRITABLE }));
  const ctxB = () =>
    anAccessContext('64b7f0000000000000000b01', memberOf({ [OFFICE_B]: WRITABLE }));

  beforeAll(async () => {
    applyMongooseDefaults(); // SC-10: the production query settings
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(db.uri), ProbeModule],
    }).compile();
    probes = moduleRef.get(ProbeRepository);
    model = moduleRef.get(getModelToken(ProbeEntity.name));
    aRecord = await probes.create(await ctxA(), { name: 'a-record', status: 'open' });
    bRecord = await probes.create(await ctxB(), { name: 'b-record', status: 'open' });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('BR-002-01 / BR-002-11: create sets the owner from the context', () => {
    expect(aRecord).toMatchObject({ ownerType: 'office', name: 'a-record' });
    expect(aRecord.ownerId.toString()).toBe(OFFICE_A);
  });

  it('an account that conducts nothing reads nothing — never "no filter"', async () => {
    const nobody = await anAccessContext('64b7f0000000000000000c01');

    expect(await probes.find(nobody)).toEqual([]);
    expect(await probes.count(nobody)).toBe(0);
    expect(await probes.findById(nobody, aRecord._id.toString())).toBeNull();
    await expect(probes.create(nobody, { name: 'x', status: 'open' })).rejects.toEqual(
      new DomainError('FORBIDDEN'),
    );
  });

  it('AR-12: a filter a subclass adds narrows the owner condition and never widens it', async () => {
    const ctx = await ctxA();

    expect(await probes.find(ctx, { ownerId: { $eq: OFFICE_B } })).toEqual([]);
    expect(await probes.find(ctx, { $or: [{ name: { $eq: 'b-record' } }] })).toEqual([]);
    expect(await probes.count(ctx, { name: { $eq: 'b-record' } })).toBe(0);
    expect((await probes.find(ctx)).map((record) => record.name)).toEqual(['a-record']);
  });

  it('BR-002-12: another owner’s id, a missing id and a malformed id are alike', async () => {
    const ctx = await ctxA();
    const notFound = new DomainError('NOT_FOUND');

    for (const id of [bRecord._id.toString(), '64b7f00000000000000ffff1', 'not-an-id']) {
      expect(await probes.findById(ctx, id)).toBeNull();
      await expect(probes.updateById(ctx, id, { name: 'x' })).rejects.toEqual(notFound);
      await expect(probes.deleteById(ctx, id)).rejects.toEqual(notFound);
    }
    expect(await model.countDocuments({ name: { $eq: 'b-record' } })).toBe(1);
  });

  it('BR-002-01: a payload or an update naming the owner or the id is a programming error', async () => {
    const ctx = await ctxA();
    const id = aRecord._id.toString();
    const planted = (fields: object) => fields as never;

    for (const fields of [{ ownerId: OFFICE_B }, { ownerType: 'self_advised' }, { _id: id }]) {
      await expect(
        probes.create(ctx, planted({ name: 'x', status: 'open', ...fields })),
      ).rejects.toThrow(/BR-002-01/);
    }
    for (const fields of [
      { ownerId: OFFICE_B },
      { 'ownerId.x': 1 },
      { ownerType: 'self_advised' },
      { $unset: { ownerId: 1 } },
    ]) {
      await expect(probes.updateById(ctx, id, planted(fields))).rejects.toThrow(/BR-002-01/);
    }
    const stored = await probes.findById(ctx, id);
    expect(stored?.ownerId.toString()).toBe(OFFICE_A);
    expect(await model.countDocuments({ name: { $eq: 'x' } })).toBe(0);
  });

  it('BR-002-11: an account of several owners must choose; the choice is one of its own', async () => {
    const both = await anAccessContext(
      '64b7f0000000000000000d01',
      memberOf({ [OFFICE_A]: WRITABLE, [OFFICE_B]: WRITABLE }),
    );

    await expect(probes.create(both, { name: 'x', status: 'open' })).rejects.toEqual(
      new DomainError('VALIDATION_FAILED', { fields: ['officeId'] }),
    );
    const created = await probes.create(
      both,
      { name: 'both-in-b', status: 'open' },
      { actingOwner: both.resolveActingOwner(OFFICE_B) },
    );
    expect(created.ownerId.toString()).toBe(OFFICE_B);
    expect(() => both.resolveActingOwner('64b7f00000000000000c0c0c')).toThrow(
      new DomainError('NOT_FOUND'),
    );
  });

  it('BR-002-11: an acting owner resolved for another request is refused', async () => {
    const first = await ctxA();
    const second = await ctxA();

    await expect(
      probes.create(
        second,
        { name: 'x', status: 'open' },
        { actingOwner: first.resolveActingOwner() },
      ),
    ).rejects.toThrow(/another request/);
  });

  it('BR-002-30: an owner that is read-only now refuses every write, its own record included', async () => {
    const ctx = await anAccessContext(
      '64b7f0000000000000000a02',
      memberOf({ [OFFICE_A]: READ_ONLY }),
    );
    const id = aRecord._id.toString();
    const readOnly = new DomainError('OFFICE_READ_ONLY');

    expect((await probes.findById(ctx, id))?.name).toBe('a-record'); // D-47: reads stay
    await expect(probes.updateById(ctx, id, { name: 'x' })).rejects.toEqual(readOnly);
    await expect(probes.deleteById(ctx, id)).rejects.toEqual(readOnly);
    await expect(probes.create(ctx, { name: 'x', status: 'open' })).rejects.toEqual(readOnly);
    // Not its own: still not found, the read-only state says nothing about B.
    await expect(probes.updateById(ctx, bRecord._id.toString(), { name: 'x' })).rejects.toEqual(
      new DomainError('NOT_FOUND'),
    );
  });

  it('updates and deletes in one conditional operation, answering the record', async () => {
    const ctx = await ctxA();
    const created = await probes.create(ctx, { name: 'to-change', status: 'open' });
    const id = created._id.toString();

    const updated = await probes.updateById(ctx, id, { status: 'closed' });
    expect(updated).toMatchObject({ name: 'to-change', status: 'closed' });
    const deleted = await probes.deleteById(ctx, id);
    expect(deleted._id.toString()).toBe(id);
    expect(await probes.findById(ctx, id)).toBeNull();
  });

  it('AR-11: refuses to scope a collection that has no owner paths', () => {
    class NotOwned extends OwnerScopedRepository<ProbeRecord> {
      constructor(unowned: Model<ProbeRecord>) {
        super(unowned);
      }
    }
    const unowned = mongoose
      .createConnection()
      .model('NotOwnedProbe', new Schema({ name: String })) as unknown as Model<ProbeRecord>;

    expect(() => new NotOwned(unowned)).toThrow(/not owned \(AR-11\)/);
  });
});
