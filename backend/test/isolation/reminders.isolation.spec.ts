// SPEC-002 BR-002-02 / BR-002-29 / TS-13..TS-18: reminders and their notification logs are the
// account's own data. Two accounts through the real API: B's reminders never reach A's list or
// count; A reading, changing or deleting B's reminder answers exactly like a random id and leaves it
// as it was; an account id planted in the request is refused or ignored (BR-002-11). The
// scheduler, which works across accounts, delivers each reminder to its own account only and logs
// the delivery under that account (no API reads the logs).
import { afterAll, beforeAll, expect, it } from 'vitest';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { AuctionEntity } from '../../src/auctions/schemas/auction.schema.js';
import { AuctionsModule } from '../../src/auctions/auctions.module.js';
import { RemindersModule } from '../../src/reminders/reminders.module.js';
import { RemindersScheduler } from '../../src/reminders/reminders.scheduler.js';
import { NotificationLog } from '../../src/reminders/schemas/notification-log.schema.js';
import { useTestDatabase } from '../support/test-database.js';
import {
  answerOf,
  createIsolationApp,
  type IsolationApp,
  RANDOM_ID,
  type TestAccount,
} from './support/isolation-app.js';
import { isolationSpecFor } from './support/isolation-spec.js';

const AUCTION_CODE = 'ISOL0001';
// The harness clock starts on 2099-01-15 (AUTH_TEST_START); the auction starts after it.
const AUCTION_START = '2099-02-01T13:00:00.000Z';
const SCHEDULED_AT = '2099-01-20T12:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;

interface ReminderBody {
  _id: string;
  description?: string;
  status: string;
}

isolationSpecFor('ReminderEntity', () => {
  const db = useTestDatabase();
  let app: IsolationApp;
  let a: TestAccount;
  let b: TestAccount;
  let aReminder = '';
  let bReminder = '';

  const create = async (account: TestAccount, description: string) =>
    (
      (
        await app
          .as(account)
          .post('/api/reminders')
          .send({
            auctionId: AUCTION_CODE,
            channel: 'EMAIL',
            scheduledAt: SCHEDULED_AT,
            description,
          })
          .expect(201)
      ).body as ReminderBody
    )._id;

  const listOf = async (account: TestAccount) =>
    (await app.as(account).get('/api/reminders').expect(200)).body as {
      items: ReminderBody[];
      total: number;
    };

  beforeAll(async () => {
    app = await createIsolationApp(db, [AuctionsModule, RemindersModule], {
      REMINDERS_ENABLED: 'true', // the scheduler runs only when this spec calls it: no cron here
    });
    const auctions = app.harness.moduleRef.get<Model<unknown>>(getModelToken(AuctionEntity.name));
    const phase = { modality: 'ONLINE_SALES', minimumPrice: null, phaseDates: [AUCTION_START] };
    await auctions.collection.insertOne({
      code: AUCTION_CODE,
      available: true,
      phases: [phase],
      currentPhase: phase,
      updatedAt: new Date('2999-01-01T00:00:00.000Z'),
    });
    [a, b] = await app.signUpAll('a', 'b');
    aReminder = await create(a, 'a-reminder');
    bReminder = await create(b, 'b-reminder');
  });

  afterAll(async () => {
    await app.close();
  });

  it('BR-002-02 / TS-16: B’s reminders never appear in A’s list or total', async () => {
    const list = await listOf(a);

    expect(list.total).toBe(1);
    expect(list.items.map((item) => item._id)).toEqual([aReminder]);
  });

  it('BR-002-12 / TS-17: B’s reminder answers A exactly like a random id, read or write', async () => {
    const as = app.as(a);
    const notFound = { status: 404, body: { code: 'REMINDER_NOT_FOUND', context: {} } };
    for (const [foreign, missing] of [
      [as.get(`/api/reminders/${bReminder}`), as.get(`/api/reminders/${RANDOM_ID}`)],
      [
        as.patch(`/api/reminders/${bReminder}`).send({ description: 'changed by A' }),
        as.patch(`/api/reminders/${RANDOM_ID}`).send({ description: 'changed by A' }),
      ],
      [as.delete(`/api/reminders/${bReminder}`), as.delete(`/api/reminders/${RANDOM_ID}`)],
    ] as const) {
      const [foreignAnswer, missingAnswer] = [await answerOf(foreign), await answerOf(missing)];
      expect(foreignAnswer).toEqual(missingAnswer);
      expect(foreignAnswer).toEqual(notFound);
    }
    const kept = await app.as(b).get(`/api/reminders/${bReminder}`).expect(200);
    expect(kept.body).toMatchObject({ _id: bReminder, description: 'b-reminder' });
  });

  it('BR-002-11: an account id in the body, query or a header is refused or ignored', async () => {
    const as = app.as(a);
    const refused = await as
      .post('/api/reminders')
      .send({ auctionId: AUCTION_CODE, channel: 'EMAIL', scheduledAt: SCHEDULED_AT, userId: b.id })
      .expect(400);
    expect(refused.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    await as.patch(`/api/reminders/${aReminder}`).send({ userId: b.id }).expect(400);
    await as.get(`/api/reminders?userId=${b.id}`).expect(400);
    const viaHeader = await as.get('/api/reminders').set('X-User-Id', b.id).expect(200);
    expect((viaHeader.body as { items: ReminderBody[] }).items.map((i) => i._id)).toEqual([
      aReminder,
    ]);
    expect((await listOf(b)).items.map((item) => item._id)).toEqual([bReminder]);
  });

  isolationSpecFor('NotificationLog', () => {
    it('BR-002-29: the scheduler delivers each reminder to its own account and logs it under that account', async () => {
      const logs = app.harness.moduleRef.get<Model<NotificationLog>>(
        getModelToken(NotificationLog.name),
      );
      app.harness.clock.advance(6 * DAY); // past both reminders' 2099-01-20 schedule

      await app.harness.moduleRef.get(RemindersScheduler).processReminders();

      const delivered = app.harness.mailbox.reminderEmails.map((sent) => ({
        email: sent.email,
        description: sent.payload.description,
      }));
      expect(delivered.sort((x, y) => x.email.localeCompare(y.email))).toEqual([
        { email: a.email, description: 'a-reminder' },
        { email: b.email, description: 'b-reminder' },
      ]);
      const stored = await logs.find().lean().exec();
      expect(
        stored
          .map((log) => ({ reminder: log.reminderId.toString(), user: log.userId.toString() }))
          .sort((x, y) => x.reminder.localeCompare(y.reminder)),
      ).toEqual(
        [
          { reminder: aReminder, user: a.id },
          { reminder: bReminder, user: b.id },
        ].sort((x, y) => x.reminder.localeCompare(y.reminder)),
      );
      // Each account sees its own reminder sent, and still nothing of the other's.
      expect((await listOf(a)).items).toEqual([
        expect.objectContaining({ _id: aReminder, status: 'SENT' }),
      ]);
      expect((await listOf(b)).items).toEqual([
        expect.objectContaining({ _id: bReminder, status: 'SENT' }),
      ]);
    });
  });
});
