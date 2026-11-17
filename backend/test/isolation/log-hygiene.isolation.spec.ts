// SPEC-002 BR-002-28 / DL-002-07 / SC-15: application logs and error answers carry no client data
// and no personal data. Reading them would otherwise be admin access with no grant and no log entry.
//
// Marker strings are seeded through the real API into every place client or personal text lives
// today — an account's name and email, a profile change, a support request's title and
// description, a saved filter's name, a reminder's note, an owned (probe) record's name — and the
// flows run end to end: success paths, refusals, a read under a support grant, a fault (the admin
// access log refusing its insert, BR-002-27) and the reminders scheduler once (FakeClock). Every
// Nest Logger call (instance and static, every level) and everything written to stdout/stderr is
// captured (captureAllLogOutput), and so is every error answer; no marker may appear in either.
//
// Sentry is not initialised in tests; what it would receive is scrubbed by
// common/observability/sentry-scrubber.ts, whose unit spec covers request bodies with these
// markers. The real EmailService's own lines (development mode included) are covered by
// src/email/email.service.logging.spec.ts; here the mailer is the harness's fake.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { type Connection, type Model, Types } from 'mongoose';
import type { OfficePlanState } from '../../src/access/sources/office-plan.source.js';
import { AuctionEntity } from '../../src/auctions/schemas/auction.schema.js';
import { AuctionsModule } from '../../src/auctions/auctions.module.js';
import { RemindersModule } from '../../src/reminders/reminders.module.js';
import { RemindersScheduler } from '../../src/reminders/reminders.scheduler.js';
import { SavedFiltersModule } from '../../src/saved-filters/saved-filters.module.js';
import { SupportModule } from '../../src/support/support.module.js';
import { DAY } from '../fakes/fake-clock.js';
import { captureAllLogOutput } from '../support/logger-spy.js';
import { useTestDatabase } from '../support/test-database.js';
import { answerOf, createIsolationApp, type IsolationApp } from './support/isolation-app.js';
import {
  PROBE_ENTITLEMENT,
  ProbeAdminModule,
  ProbeModule,
  type ProbeAnswer,
} from './support/probe.module.js';

const OFFICE_A = '64b7f00000000000000a0a0a';
const WRITABLE: OfficePlanState = {
  advisorPlanActive: true,
  readOnly: false,
  entitlements: [PROBE_ENTITLEMENT],
};
const AUCTION_CODE = 'LOGS0001';
const AUCTION_START = '2099-02-01T13:00:00.000Z'; // after the harness clock's 2099-01-15
const SCHEDULED_AT = '2099-01-20T12:00:00.000Z';

const MARKERS = {
  accountName: 'MKR-ACCOUNT-NAME-QX7',
  profileName: 'MKR-PROFILE-NAME-QX7',
  supportTitle: 'MKR-SUPPORT-TITLE-QX7',
  supportDescription: 'MKR-SUPPORT-DESCRIPTION-QX7 a private message',
  filterName: 'MKR-FILTER-NAME-QX7',
  reminderNote: 'MKR-REMINDER-NOTE-QX7',
  probeName: 'MKR-PROBE-NAME-QX7',
} as const;

describe('BR-002-28 / SC-15: no client or personal data in logs or error answers', () => {
  const db = useTestDatabase();
  let app: IsolationApp;
  let logged = '';
  const errorBodies: unknown[] = [];
  const emails: string[] = [];

  /** Runs a request; keeps its body when it is an error answer. */
  async function call(test: Parameters<typeof answerOf>[0]) {
    const answer = await answerOf(test);
    if (answer.status >= 400) errorBodies.push(answer.body);
    return answer;
  }

  beforeAll(async () => {
    app = await createIsolationApp(
      db,
      [
        ProbeModule,
        ProbeAdminModule,
        SavedFiltersModule,
        AuctionsModule,
        RemindersModule,
        SupportModule,
      ],
      { REMINDERS_ENABLED: 'true' }, // the scheduler runs only when this spec calls it
    );
    const { moduleRef, clock } = app.harness;
    const auctions = moduleRef.get<Model<unknown>>(getModelToken(AuctionEntity.name));
    const phase = { modality: 'ONLINE_SALES', minimumPrice: null, phaseDates: [AUCTION_START] };
    await auctions.collection.insertOne({
      code: AUCTION_CODE,
      available: true,
      phases: [phase],
      currentPhase: phase,
      updatedAt: new Date('2999-01-01T00:00:00.000Z'),
    });
    app.sources.plans = { [OFFICE_A]: WRITABLE };

    const capture = captureAllLogOutput();
    try {
      // An account whose name is a marker; a member of A; an admin with a support grant on it.
      const member = await app.signUp('marker-member', MARKERS.accountName);
      const admin = await app.signUp('marker-admin');
      emails.push(member.email, admin.email);
      app.sources.forAccount(member.id, { memberships: [{ officeId: OFFICE_A }] });
      await app.makeAdmin(admin);
      const as = app.as(member);

      await call(as.patch('/api/auth/profile').send({ name: MARKERS.profileName }));
      await call(
        as.patch('/api/auth/profile').send({ name: `${MARKERS.profileName}${'x'.repeat(300)}` }),
      );

      // A support request (SPEC-009 will store it; today it is emailed to the team).
      await call(
        as
          .post('/api/support')
          .send({ title: MARKERS.supportTitle, description: MARKERS.supportDescription }),
      );
      await call(
        as.post('/api/support').send({ title: MARKERS.supportTitle, description: 'short' }),
      );

      // A saved filter, then the same name again (SAVED_FILTER_NAME_TAKEN).
      for (let i = 0; i < 2; i += 1) {
        await call(
          as
            .post('/api/saved-filters')
            .send({ name: MARKERS.filterName, filters: { state: 'SP' } }),
        );
      }

      // A reminder with a note, one refused with the same note, and the scheduler delivering it.
      const reminder = {
        auctionId: AUCTION_CODE,
        channel: 'EMAIL',
        scheduledAt: SCHEDULED_AT,
        description: MARKERS.reminderNote,
      };
      await call(as.post('/api/reminders').send(reminder));
      await call(
        as.post('/api/reminders').send({ ...reminder, scheduledAt: '2000-01-01T00:00:00Z' }),
      );
      await call(as.post('/api/reminders').send({ ...reminder, channel: 'SMS' }));

      // An owned record, read and refused, then read by the admin under a support grant.
      const created = await call(as.post('/api/probes').send({ name: MARKERS.probeName }));
      const probeId = (created.body as ProbeAnswer).id;
      await call(as.get(`/api/probes/${probeId}`));
      await call(
        as.patch(`/api/probes/${probeId}`).send({ name: `${MARKERS.probeName}${'y'.repeat(200)}` }),
      );
      const supportRequestId = new Types.ObjectId().toHexString();
      app.supportRequests.set(supportRequestId, member.id);
      const opened = await call(
        app.as(admin).post('/api/probe-admin/grants').send({ supportRequestId }),
      );
      const grantId = (opened.body as { id: string }).id;
      await call(app.as(admin).get(`/api/probe-admin/grants/${grantId}/probes`));
      await call(
        app
          .as(admin)
          .patch(`/api/probe-admin/grants/${grantId}/probes/${probeId}`)
          .send({ name: MARKERS.probeName }),
      );

      // A fault: the admin access log refuses its insert, so the read fails (BR-002-27).
      const connection = moduleRef.get<Connection>(getConnectionToken());
      await connection.db?.command({
        collMod: 'adminAccessLogs',
        validator: { $jsonSchema: { required: ['a field no entry has'] } },
      });
      await call(app.as(admin).get(`/api/probe-admin/grants/${grantId}/probes/${probeId}`));
      await connection.db?.command({ collMod: 'adminAccessLogs', validator: {} });

      // The reminders job once, past the reminder's time (BR-002-29 delivers it to its account).
      clock.advance(6 * DAY);
      await moduleRef.get(RemindersScheduler).processReminders();
    } finally {
      logged = capture.text();
      capture.restore();
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('ran the flows: the capture is wired and saw the success, refusal and fault lines', () => {
    expect(logged).toContain('Support request submitted');
    expect(logged).toContain('sent successfully via EMAIL');
    expect(logged).toContain('BR-002-27: admin access log not written');
    expect(logged).toContain('Unhandled AdminAccessLogUnavailableError');
    expect(app.harness.mailbox.reminderEmails).toHaveLength(1);
    expect(errorBodies.length).toBeGreaterThanOrEqual(6);
  });

  it.each(Object.entries(MARKERS))('no log line holds the %s marker', (_field, marker) => {
    expect(logged).not.toContain(marker);
  });

  it('no log line holds an account email', () => {
    for (const email of emails) expect(logged).not.toContain(email);
  });

  it('no error answer holds a marker or an email (AR-40)', () => {
    const answers = JSON.stringify(errorBodies);
    for (const value of [...Object.values(MARKERS), ...emails]) {
      expect(answers).not.toContain(value);
    }
  });
});
