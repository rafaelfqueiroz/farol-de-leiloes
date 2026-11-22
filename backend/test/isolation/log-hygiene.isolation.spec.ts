// SPEC-002 BR-002-28 / DL-002-07 / SC-15: application logs and error answers carry no client data
// and no personal data. Reading them would otherwise be admin access with no grant and no log entry.
//
// Marker strings are seeded through the real API into every place client or personal text lives
// today — an account's name and email, a profile change, a support request's title and
// description, a saved filter's name, a reminder's note, an owned (probe) record's name, the name and
// address of an office member who gets the payment-failed email, the name of a buyer whose
// customer the payment provider is told about (SPEC-012) and the name and e-mail of accounts that
// sign up with an acceptance and a WhatsApp answer (SPEC-010), and the name, e-mail and phone of an
// account that asks for its data export, downloads it, is refused, deletes itself and is purged
// (SPEC-010 part 2; the export's content and link are never logged) — and the flows run end to end: success
// paths, refusals, a read under a support grant, a fault (the admin access log refusing its
// insert, BR-002-27), the reminders scheduler once and the subscriptions reconcile job (FakeClock). No
// marker may appear in any of three captures:
//   - every Nest Logger call (instance and static, every level, its arguments) and everything
//     written to stdout/stderr (captureAllLogOutput);
//   - the PRODUCTION log path: the app runs with nestjs-pino configured by the API's own
//     `loggerParams` at level info (what ObservabilityModule builds, AR-45), writing into memory,
//     so pino-http's request completion lines and pino's serialized errors are scanned as the
//     JSON lines production would write;
//   - every error answer.
//
// Sentry is not initialised in tests; what it would receive is scrubbed by
// common/observability/sentry-scrubber.ts, whose unit spec covers request bodies with these
// markers. The real EmailService's own lines (development mode included) are covered by
// src/email/email.service.logging.spec.ts; here the mailer is the harness's fake.
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { type Connection, type Model, Types } from 'mongoose';
import { Logger as PinoLogger, LoggerModule } from 'nestjs-pino';
import request from 'supertest';
import type { OfficePlanState } from '../../src/access/sources/office-plan.source.js';
import { AuctionEntity } from '../../src/auctions/schemas/auction.schema.js';
import { AuctionsModule } from '../../src/auctions/auctions.module.js';
import { Decimal } from '../../src/common/money/money.js';
import { loggerParams } from '../../src/common/observability/logger-options.js';
import { PaymentGateway } from '../../src/payments/payment-gateway.js';
import { PlansService } from '../../src/plans/plans.service.js';
import { AccountPurgeJob } from '../../src/privacy/rights/account-purge.job.js';
import { DataExportJob } from '../../src/privacy/rights/data-export.job.js';
import { PrivacyRightsModule } from '../../src/privacy/rights/privacy-rights.module.js';
import { RemindersModule } from '../../src/reminders/reminders.module.js';
import { RemindersScheduler } from '../../src/reminders/reminders.scheduler.js';
import { SavedFiltersModule } from '../../src/saved-filters/saved-filters.module.js';
import { OFFICE_MEMBERS_SOURCE } from '../../src/subscriptions/ports/office-members.source.js';
import { OFFICE_PROVISIONER } from '../../src/subscriptions/ports/office-provisioner.js';
import { SubscriptionsBillingModule } from '../../src/subscriptions/subscriptions-billing.module.js';
import { SubscriptionsReconcileJob } from '../../src/subscriptions/subscriptions-reconcile.job.js';
import { SubscriptionsRepository } from '../../src/subscriptions/subscriptions.repository.js';
import { SubscriptionsService } from '../../src/subscriptions/subscriptions.service.js';
import { StorageService } from '../../src/storage/storage.service.js';
import { SupportModule } from '../../src/support/support.module.js';
import { aProviderSubscription } from '../builders/provider-subscription.builder.js';
import { DAY } from '../fakes/fake-clock.js';
import { FakeOfficeProvisioner } from '../fakes/fake-office-provisioner.js';
import { FakePaymentGateway } from '../fakes/fake-payment-gateway.js';
import { FakeStorage } from '../fakes/fake-storage.js';
import { captureAllLogOutput } from '../support/logger-spy.js';
import { useTestDatabase } from '../support/test-database.js';
import {
  answerOf,
  createIsolationApp,
  type IsolationApp,
  RANDOM_ID,
} from './support/isolation-app.js';
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
  memberContactName: 'MKR-MEMBER-CONTACT-NAME-QX7',
  buyerName: 'MKR-BUYER-NAME-QX7',
  consentName: 'MKR-CONSENT-NAME-QX7',
  exportName: 'MKR-EXPORT-NAME-QX7',
  // The digits of the phone the rights account gives (+55 11 91234-9999, stored as +5511912349999).
  exportPhone: '5511912349999',
} as const;
/** SPEC-012 BR-012-20: an office member the payment-failed email is addressed to. */
const MEMBER_CONTACT = {
  email: 'mkr-member-contact-qx7@example.test',
  name: MARKERS.memberContactName,
};

describe('BR-002-28 / SC-15: no client or personal data in logs or error answers', () => {
  const db = useTestDatabase();
  let app: IsolationApp;
  let logged = '';
  /** The JSON lines the production logger wrote (pino at level info, into memory). */
  const pinoLines: string[] = [];
  const memory = new Writable({
    write(chunk: Buffer, _encoding, done) {
      pinoLines.push(...chunk.toString().split('\n').filter(Boolean));
      done();
    },
  });
  const errorBodies: unknown[] = [];
  const emails: string[] = [MEMBER_CONTACT.email];
  const gateway = new FakePaymentGateway();
  const storage = new FakeStorage();

  /** Runs a request; keeps its body when it is an error answer. */
  async function call(test: Parameters<typeof answerOf>[0]) {
    const answer = await answerOf(test);
    if (answer.status >= 400) errorBodies.push(answer.body);
    return answer;
  }

  beforeAll(async () => {
    const params = loggerParams('info');
    app = await createIsolationApp(
      db,
      [
        // The API's pino configuration (AR-45), with an in-memory destination (TESTING §2).
        LoggerModule.forRoot({ ...params, pinoHttp: [params.pinoHttp as object, memory] }),
        ProbeModule,
        ProbeAdminModule,
        SavedFiltersModule,
        AuctionsModule,
        RemindersModule,
        SupportModule,
        SubscriptionsBillingModule,
        PrivacyRightsModule,
      ],
      // The reminders scheduler runs only when this spec calls it; exports go to a fake private bucket.
      { REMINDERS_ENABLED: 'true', R2_PRIVATE_BUCKET: 'mkr-private-bucket' },
      // As main.ts does: every Nest Logger line goes through pino from here on.
      (nest) => nest.useLogger(nest.get(PinoLogger)),
      (builder) =>
        builder
          .overrideProvider(PaymentGateway)
          .useValue(gateway)
          .overrideProvider(StorageService)
          .useValue(storage)
          .overrideProvider(OFFICE_PROVISIONER)
          .useValue(new FakeOfficeProvisioner())
          // SPEC-011's source: the member contacts the payment-failed email goes to.
          .overrideProvider(OFFICE_MEMBERS_SOURCE)
          .useValue({ memberContacts: () => Promise.resolve([MEMBER_CONTACT]) }),
    );
    const { moduleRef, clock } = app.harness;
    // The unique acceptance index (migration 0008 in production) must exist before the first sign-up:
    // autoIndex builds it in the background, and under load a repeated accept could otherwise slip
    // in a duplicate row before it is there.
    await moduleRef.get<Connection>(getConnectionToken()).syncIndexes();
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

    pinoLines.length = 0; // the scan covers the flows, not the boot
    const capture = captureAllLogOutput({ passThrough: true });
    try {
      // An account whose name is a marker; a member of A; an admin with a support grant on it.
      const member = await app.signUp('marker-member', MARKERS.accountName);
      const admin = await app.signUp('marker-admin');
      emails.push(member.email, admin.email);
      app.sources.forAccount(member.id, { memberships: [{ officeId: OFFICE_A }] });
      await app.makeAdmin(admin);
      const as = app.as(member);

      // SPEC-010: a sign-up that records the acceptance and the WhatsApp answer (name and e-mail are
      // markers), a stale-version refusal, an accept, an answer and the reads, refusals included.
      const consenting = await app.signUp('marker-consent', MARKERS.consentName);
      emails.push(consenting.email);
      const staleEmail = 'mkr-stale-signup-qx7@example.test';
      emails.push(staleEmail);
      await call(
        request(app.harness.app.getHttpServer() as Parameters<typeof request>[0])
          .post('/api/auth/register')
          .send({
            email: staleEmail,
            password: 'correct horse battery',
            name: MARKERS.consentName,
            acceptTerms: true,
            termsVersion: '0.0',
          }),
      );
      const consentSession = app.as(consenting);
      await call(consentSession.get('/api/privacy/acceptances'));
      await call(
        consentSession
          .post('/api/privacy/accept')
          .send({ termsVersion: '0.1', privacyVersion: '0.1' }),
      );
      await call(
        consentSession
          .post('/api/privacy/accept')
          .send({ termsVersion: '0.0', privacyVersion: '0.1' }),
      );
      await call(
        consentSession
          .post('/api/privacy/whatsapp-consent')
          .send({ action: 'granted', method: 'privacy_page' }),
      );
      await call(consentSession.post('/api/privacy/whatsapp-consent').send({ action: 'maybe' }));
      await call(consentSession.get('/api/privacy/whatsapp-consent'));
      await call(consentSession.get('/api/auth/me'));

      // SPEC-010 part 2: the data-subject rights. An account (name, e-mail and phone are markers)
      // asks for its data, sees it, downloads the export, is refused another account's, fails and
      // then passes the re-authentication, is closed and purged, and the export files expire.
      const rights = await app.signUp('marker-rights', MARKERS.exportName);
      emails.push(rights.email);
      const rightsSession = app.as(rights);
      await call(rightsSession.patch('/api/auth/profile').send({ phone: '+55 11 91234-9999' }));
      await call(
        rightsSession
          .post('/api/saved-filters')
          .send({ name: MARKERS.filterName, filters: { state: 'RN' } }),
      );
      await call(rightsSession.get('/api/privacy/my-data'));
      const queued = await call(rightsSession.post('/api/privacy/exports'));
      await moduleRef.get(DataExportJob).runBuild();
      const exportId = (queued.body as { id: string }).id;
      await call(rightsSession.get(`/api/privacy/exports/${exportId}/download`));
      await call(rightsSession.get('/api/privacy/exports'));
      await call(as.get(`/api/privacy/exports/${exportId}/download`)); // another account's: 404
      await call(as.get(`/api/privacy/exports/${RANDOM_ID}/download`));
      await call(rightsSession.post('/api/privacy/delete-account').send({ confirm: true }));
      await call(
        rightsSession
          .post('/api/privacy/delete-account')
          .send({ password: 'a wrong password', confirm: true }),
      );
      await call(
        rightsSession
          .post('/api/privacy/delete-account')
          .send({ password: 'correct horse battery', confirm: true }),
      );
      await call(rightsSession.get('/api/privacy/my-data')); // refused: the account is closed
      await moduleRef.get(AccountPurgeJob).run();
      await moduleRef.get(DataExportJob).runExpiry();

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
      await call(app.as(admin).get(`/api/probe-admin/grants/${grantId}/probes/${RANDOM_ID}`));

      // A fault: the admin access log refuses its insert, so the read fails (BR-002-27).
      const connection = moduleRef.get<Connection>(getConnectionToken());
      // collMod cannot run while a background index build (autoIndex) is still going on this database.
      await connection.syncIndexes();
      await connection.db?.command({
        collMod: 'adminAccessLogs',
        validator: { $jsonSchema: { required: ['a field no entry has'] } },
      });
      await call(app.as(admin).get(`/api/probe-admin/grants/${grantId}/probes/${probeId}`));
      await connection.db?.command({ collMod: 'adminAccessLogs', validator: {} });

      // SPEC-012: the office plan's flows, refusals included, then a failed renewal that emails the
      // member contact, then the reconcile job (all through the fake provider).
      const plans = moduleRef.get(PlansService);
      const catalog = [
        { code: 'mkr-5', limit: 5, price: '199.90', priceId: 'price_mkr_5' },
        { code: 'mkr-10', limit: 10, price: '349.90', priceId: 'price_mkr_10' },
      ].map((plan) => ({
        code: plan.code,
        name: plan.code,
        price: new Decimal(plan.price),
        interval: 'month' as const,
        activeJourneyLimit: plan.limit,
        stripePriceId: plan.priceId,
        status: 'OFFERED' as const,
        sortOrder: plan.limit,
      }));
      for (const plan of catalog) {
        gateway.listsPlan(plan);
      }
      await plans.upsertCatalog(catalog);
      const subscriptions = moduleRef.get(SubscriptionsRepository);
      const sync = moduleRef.get(SubscriptionsService);
      const planFive = await plans.findByCode('mkr-5');
      const pending = await subscriptions.createPending({
        buyerUserId: member.id,
        planId: planFive?.id ?? '',
        planCode: 'mkr-5',
        activeJourneyLimit: 5,
        officeId: OFFICE_A,
        checkoutSessionId: 'cs_mkr',
      });
      gateway.setSubscription(
        aProviderSubscription({
          id: 'sub_mkr',
          subscriptionRef: pending.id,
          priceId: 'price_mkr_5',
          currentPeriodStart: new Date('2099-01-10T12:00:00.000Z'),
          currentPeriodEnd: new Date('2099-02-10T12:00:00.000Z'),
          firstInvoicePaidAt: new Date('2099-01-10T12:00:05.000Z'),
        }),
      );
      await sync.handleProviderEvent({
        id: 'evt_mkr_1',
        type: 'checkout.completed',
        subscriptionId: 'sub_mkr',
        subscriptionRef: pending.id,
      });
      await call(as.get('/api/office/subscription'));
      await call(as.post('/api/office/subscription/checkout').send({ planCode: 'mkr-5' })); // already active
      await call(as.post('/api/office/subscription/checkout').send({ planCode: 'no-such-plan' }));
      await call(as.post('/api/office/subscription/change').send({ planCode: 'mkr-10' }));
      const buyer = await app.signUp('marker-buyer', MARKERS.buyerName);
      emails.push(buyer.email);
      await call(
        app.as(buyer).post('/api/office/subscription/checkout').send({ planCode: 'mkr-5' }),
      );
      gateway.setSubscription({ ...gateway.current('sub_mkr'), status: 'past_due' });
      await sync.handleProviderEvent({
        id: 'evt_mkr_2',
        type: 'invoice.payment_failed',
        subscriptionId: 'sub_mkr',
      });
      await call(as.post('/api/office/subscription/cancel').send({}));
      await moduleRef.get(SubscriptionsReconcileJob).run();

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

  it('ran the flows through pino: completion lines and the fault’s serialized error are there', () => {
    const lines = pinoLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const routes = lines.filter((line) => line.msg === 'request completed').map((l) => l.route);
    expect(routes).toEqual(
      expect.arrayContaining([
        '/api/support',
        '/api/saved-filters',
        '/api/reminders',
        '/api/probes/:id',
        '/api/probe-admin/grants/:grantId/probes',
      ]),
    );
    expect(lines.filter((line) => line.msg === 'request failed').length).toBeGreaterThanOrEqual(1);
    expect(pinoLines.join('\n')).toContain('AdminAccessLogUnavailableError');
    expect(lines.some((line) => String(line.msg).startsWith('Support request submitted'))).toBe(
      true,
    );
  });

  it.each(Object.entries(MARKERS))(
    'no production (pino) line holds the %s marker',
    (_f, marker) => {
      expect(pinoLines.join('\n')).not.toContain(marker);
    },
  );

  it('no production (pino) line holds an account email', () => {
    for (const email of emails) expect(pinoLines.join('\n')).not.toContain(email);
  });

  it('ran the flows: the capture is wired and saw the success, refusal and fault lines', () => {
    expect(logged).toContain('Support request submitted');
    expect(logged).toContain('sent successfully via EMAIL');
    expect(logged).toContain('BR-002-27: admin access log not written');
    expect(logged).toContain('Unhandled AdminAccessLogUnavailableError');
    expect(app.harness.mailbox.reminderEmails).toHaveLength(1);
    // SPEC-012: the failed renewal reached the member contact, and the job ran.
    expect(app.harness.mailbox.paymentFailedEmails).toEqual([
      { email: MEMBER_CONTACT.email, name: MEMBER_CONTACT.name },
    ]);
    expect(logged).toContain('Payment failed email sent to 1 of 1 members');
    expect(logged).toContain('Subscriptions reconciled');
    // SPEC-010 part 2: the export was built and the account purged, by counts.
    expect(logged).toContain('Data exports: 1 ready, 0 failed, 0 discarded');
    expect(logged).toContain('Account purge: 1 purged, 0 skipped, 0 failed, 0 overdue');
    expect(storage.files.size).toBe(0); // the closed account's export file was deleted
    // SPEC-010: the consent flows ran, including their refusals.
    expect(errorBodies).toContainEqual({
      code: 'TERMS_VERSION_OUTDATED',
      context: {
        documents: [
          { type: 'terms', version: '0.1' },
          { type: 'privacy', version: '0.1' },
        ],
      },
    });
    expect(gateway.customers).toHaveLength(1); // the provider was told the buyer, not the log
    expect(errorBodies.length).toBeGreaterThanOrEqual(10);
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
