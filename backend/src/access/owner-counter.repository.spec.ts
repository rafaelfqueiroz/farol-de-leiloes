// SPEC-002 BR-002-13 / AR-15: the parts of OwnerCounterRepository that need no database. The model
// is a real Mongoose model on an unconnected Mongoose instance, its `updateOne` stubbed, so the
// filter the repository builds is observed directly (TS-07: nothing leaves the process). The
// counting itself is proven against MongoDB in test/integration/owner-counter.spec.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Mongoose, Types } from 'mongoose';
import { anAccessContext } from '../../test/fakes/fake-access-sources.js';
import { OwnerCounterRepository } from './owner-counter.repository.js';
import { OwnerCounterEntity, OwnerCounterSchema } from './schemas/owner-counter.schema.js';

const OFFICE = '64b7f00000000000000a0a0a';
const WRITABLE = { advisorPlanActive: true, readOnly: false, entitlements: [] };

function repositoryWithStubbedUpdate() {
  const model = new Mongoose().model(OwnerCounterEntity.name, OwnerCounterSchema);
  const updateOne = vi
    .spyOn(model, 'updateOne')
    .mockReturnValue({ exec: () => Promise.resolve({ modifiedCount: 1 }) } as never);
  return { repository: new OwnerCounterRepository(model), updateOne };
}

const member = () =>
  anAccessContext('64b7f0000000000000000a01', {
    memberships: [{ officeId: OFFICE }],
    officePlans: { [OFFICE]: WRITABLE },
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OwnerCounterRepository.release', () => {
  it('accepts the ObjectId owner a stored record carries, normalised to its string (no 500)', async () => {
    const { repository, updateOne } = repositoryWithStubbedUpdate();
    const ctx = await member();

    const released = await repository.release(
      ctx,
      { ownerType: 'office', ownerId: new Types.ObjectId(OFFICE) },
      'journeys',
    );

    expect(released).toBe(true);
    const [filter] = updateOne.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(filter).toMatchObject({ ownerType: 'office', ownerId: OFFICE, key: 'journeys' });
  });

  it('refuses an ObjectId owner the request may not write to, like a string one (AR-12)', async () => {
    const { repository, updateOne } = repositoryWithStubbedUpdate();
    const ctx = await member();

    await expect(
      repository.release(
        ctx,
        { ownerType: 'office', ownerId: new Types.ObjectId('64b7f00000000000000b0b0b') },
        'journeys',
      ),
    ).rejects.toThrow(/may write to/);
    expect(updateOne).not.toHaveBeenCalled();
  });
});

describe('OwnerCounterRepository.releaseByJob (AR-12: the named unscoped method)', () => {
  it('takes no AccessContext: the owner is the ended record’s, normalised, and only a positive count is lowered', async () => {
    const { repository, updateOne } = repositoryWithStubbedUpdate();

    const released = await repository.releaseByJob(
      { ownerType: 'office', ownerId: new Types.ObjectId('64b7f00000000000000b0b0b') },
      'journeys',
    );

    expect(released).toBe(true);
    const [filter, update] = updateOne.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(filter).toMatchObject({
      ownerType: 'office',
      ownerId: '64b7f00000000000000b0b0b',
      key: 'journeys',
    });
    expect(update).toEqual({ $inc: { value: -1 } });
  });

  it('answers false when nothing was lowered (the count was already zero)', async () => {
    const { repository, updateOne } = repositoryWithStubbedUpdate();
    updateOne.mockReturnValue({ exec: () => Promise.resolve({ modifiedCount: 0 }) } as never);

    expect(
      await repository.releaseByJob({ ownerType: 'office', ownerId: OFFICE }, 'journeys'),
    ).toBe(false);
  });
});

describe('OwnerCounterRepository.setCountByJob', () => {
  it.each([-1, 1.5, Number.NaN])(
    'refuses %s: a count is a whole number, zero or more',
    async (bad) => {
      const { repository, updateOne } = repositoryWithStubbedUpdate();

      await expect(
        repository.setCountByJob({ ownerType: 'office', ownerId: OFFICE }, 'journeys', bad),
      ).rejects.toThrow(/whole number/);
      expect(updateOne).not.toHaveBeenCalled();
    },
  );
});
