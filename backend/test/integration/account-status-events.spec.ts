// SPEC-009 BR-009-16, BR-009-17 / AR-30: the account status history is insert-only on a real MongoDB:
// the schema's middleware refuses every update, replace, delete, bulk write and re-save of an entry
// (the repository exposes none of them; test/structural/account-status-events-append-only.spec.ts
// holds the source), and the history is read newest first and cut at its limit.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { type Connection, type Model, Types } from 'mongoose';
import {
  AccountStatusEventsRepository,
  HISTORY_LIMIT,
} from '../../src/admin-accounts/account-status-events.repository.js';
import { AdminAccountsModule } from '../../src/admin-accounts/admin-accounts.module.js';
import {
  type AccountStatusEventDocument,
  AccountStatusEventEntity,
} from '../../src/admin-accounts/schemas/account-status-event.schema.js';
import { createAuthTestApp, type AuthTestApp } from '../support/auth-test-app.js';
import { useTestDatabase } from '../support/test-database.js';

describe('the account status history is insert-only (AR-30)', () => {
  const db = useTestDatabase();
  let harness: AuthTestApp;
  let events: Model<AccountStatusEventDocument>;
  let repository: AccountStatusEventsRepository;
  const admin = new Types.ObjectId().toHexString();

  const entry = (
    userId: string,
    minutes: number,
    action: 'deactivated' | 'reactivated' = 'deactivated',
  ) => ({
    userId,
    action,
    adminUserId: admin,
    reason: `motivo ${minutes}`,
    at: new Date(Date.UTC(2099, 0, 15, 12, minutes)),
  });

  beforeAll(async () => {
    harness = await createAuthTestApp(db, [AdminAccountsModule], { REMINDERS_ENABLED: 'false' });
    await harness.moduleRef.get<Connection>(getConnectionToken()).syncIndexes();
    events = harness.moduleRef.get(getModelToken(AccountStatusEventEntity.name), { strict: false });
    repository = harness.moduleRef.get(AccountStatusEventsRepository);
  });

  afterAll(async () => {
    await harness.app.close();
  });

  it('appends an entry and reads it back newest first, as plain values', async () => {
    const user = new Types.ObjectId().toHexString();
    await repository.append(entry(user, 1));
    await repository.append(entry(user, 3, 'reactivated'));
    await repository.append(entry(user, 2));

    expect(await repository.historyOf(user)).toEqual([
      {
        action: 'reactivated',
        adminUserId: admin,
        reason: 'motivo 3',
        at: new Date('2099-01-15T12:03:00Z'),
      },
      {
        action: 'deactivated',
        adminUserId: admin,
        reason: 'motivo 2',
        at: new Date('2099-01-15T12:02:00Z'),
      },
      {
        action: 'deactivated',
        adminUserId: admin,
        reason: 'motivo 1',
        at: new Date('2099-01-15T12:01:00Z'),
      },
    ]);
  });

  it('reads one account’s history only, and nothing for a malformed id', async () => {
    const one = new Types.ObjectId().toHexString();
    const other = new Types.ObjectId().toHexString();
    await repository.append(entry(one, 1));
    await repository.append(entry(other, 2));

    expect((await repository.historyOf(one)).map((e) => e.reason)).toEqual(['motivo 1']);
    expect(await repository.historyOf('nao-e-um-id')).toEqual([]);
  });

  it(`cuts a long history at the newest ${HISTORY_LIMIT} entries`, async () => {
    const user = new Types.ObjectId().toHexString();
    await events.insertMany(
      Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => ({
        ...entry(user, 0),
        userId: new Types.ObjectId(user),
        adminUserId: new Types.ObjectId(admin),
        at: new Date(Date.UTC(2099, 0, 1) + i * 60_000),
        reason: `n${i}`,
      })),
    );

    const history = await repository.historyOf(user);

    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history[0]?.reason).toBe(`n${HISTORY_LIMIT + 4}`);
    expect(history[HISTORY_LIMIT - 1]?.reason).toBe('n5');
  });

  it.each([
    [
      'updateOne',
      (model: Model<AccountStatusEventDocument>) =>
        model.updateOne({}, { $set: { reason: 'x' } }).exec(),
    ],
    [
      'updateMany',
      (model: Model<AccountStatusEventDocument>) =>
        model.updateMany({}, { $set: { reason: 'x' } }).exec(),
    ],
    [
      'findOneAndUpdate',
      (model: Model<AccountStatusEventDocument>) =>
        model.findOneAndUpdate({}, { $set: { reason: 'x' } }).exec(),
    ],
    [
      'replaceOne',
      (model: Model<AccountStatusEventDocument>) => model.replaceOne({}, { reason: 'x' }).exec(),
    ],
    ['deleteOne', (model: Model<AccountStatusEventDocument>) => model.deleteOne({}).exec()],
    ['deleteMany', (model: Model<AccountStatusEventDocument>) => model.deleteMany({}).exec()],
    [
      'findOneAndDelete',
      (model: Model<AccountStatusEventDocument>) => model.findOneAndDelete({}).exec(),
    ],
    [
      'bulkWrite',
      (model: Model<AccountStatusEventDocument>) =>
        model.bulkWrite([{ deleteMany: { filter: {} } }]),
    ],
  ])('the model refuses %s: the history is append-only', async (_name, run) => {
    const user = new Types.ObjectId().toHexString();
    await repository.append(entry(user, 1));
    const before = await events.countDocuments();

    await expect(run(events)).rejects.toThrow('append-only');

    expect(await events.countDocuments()).toBe(before);
    expect((await repository.historyOf(user))[0]?.reason).toBe('motivo 1');
  });

  it('the model refuses to save an entry that is already stored', async () => {
    const user = new Types.ObjectId().toHexString();
    await repository.append(entry(user, 1));
    const stored = await events.findOne({ userId: user }).exec();
    if (!stored) throw new Error('the entry was not stored');
    stored.reason = 'editado';

    await expect(stored.save()).rejects.toThrow('append-only');
    expect((await repository.historyOf(user))[0]?.reason).toBe('motivo 1');
  });
});
