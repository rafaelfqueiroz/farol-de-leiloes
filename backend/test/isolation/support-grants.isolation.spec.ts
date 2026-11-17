// SPEC-002 BR-002-23..BR-002-27 / DL-002-04: the admin's only path to client data, a support access
// grant, proven through HTTP on the PROBE collection (support/probe.module.ts:
// ProbeAdminGrantController, the template of SPEC-009/016/021's admin grant routes). The real
// SupportGrantService, GrantReadLogger, AccessContextFactory, repositories and MongoDB indexes; the
// relationships and SPEC-009's support requests are fakes the spec drives (TS-03).
//
// The cast: offices A and B share investor X (self-advised too); `memberA` is a member of A. Each
// test opens its grants on fresh support requests, so one test's ended grant never affects another.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { type Connection, type Model, Types } from 'mongoose';
import type { OfficePlanState } from '../../src/access/sources/office-plan.source.js';
import {
  type AdminAccessLogDocument,
  AdminAccessLogEntity,
} from '../../src/admin-access/schemas/admin-access-log.schema.js';
import {
  type SupportAccessGrantDocument,
  SupportAccessGrantEntity,
} from '../../src/admin-access/schemas/support-access-grant.schema.js';
import { SupportGrantService } from '../../src/admin-access/support-grant.service.js';
import { DAY, MINUTE } from '../fakes/fake-clock.js';
import { spyOnLogger } from '../support/logger-spy.js';
import { useTestDatabase } from '../support/test-database.js';
import {
  type Answer,
  answerOf,
  createIsolationApp,
  type IsolationApp,
  RANDOM_ID,
  type TestAccount,
} from './support/isolation-app.js';
import {
  PROBE_ENTITLEMENT,
  ProbeAdminModule,
  ProbeModule,
  type ProbeAnswer,
} from './support/probe.module.js';

const OFFICE_A = '64b7f00000000000000a0a0a';
const OFFICE_B = '64b7f00000000000000b0b0b';
const WRITABLE: OfficePlanState = {
  advisorPlanActive: true,
  readOnly: false,
  entitlements: [PROBE_ENTITLEMENT],
};

const NOT_FOUND: Answer = { status: 404, body: { code: 'NOT_FOUND', context: {} } };
const FAULT: Answer = { status: 500, body: { code: 'INTERNAL_ERROR', context: {} } };

interface OpenedGrantBody {
  id: string;
  supportRequestId: string;
  openedAt: string;
  expiresAt: string;
}

describe('support access grants through the API (SPEC-002 BR-002-23..BR-002-27)', () => {
  const db = useTestDatabase();
  let app: IsolationApp;
  let grants: Model<SupportAccessGrantDocument>;
  let logs: Model<AdminAccessLogDocument>;
  let connection: Connection;
  const ids: Record<string, string> = {};
  let memberA: TestAccount;
  let memberB: TestAccount;
  let investorX: TestAccount;
  let admin: TestAccount;
  let otherAdmin: TestAccount;

  const idOf = (name: string) => ids[name] ?? '';
  const xLinksActive = () => ({
    clientLinks: [
      { officeId: OFFICE_A, status: 'active' as const },
      { officeId: OFFICE_B, status: 'active' as const },
    ],
    selfAdvised: true,
    selfAdvisedEntitlements: [PROBE_ENTITLEMENT],
  });

  /** A new support request of `requester` in SPEC-009's (fake) store. */
  function newRequest(
    requester: TestAccount,
    state: { open?: boolean; dataAccessAllowed?: boolean } = {},
  ): string {
    const id = new Types.ObjectId().toHexString();
    app.supportRequests.set(id, requester.id, state);
    return id;
  }

  const openAnswer = (account: TestAccount, supportRequestId: string) =>
    answerOf(app.as(account).post('/api/probe-admin/grants').send({ supportRequestId }));

  async function openGrant(account: TestAccount, supportRequestId: string): Promise<string> {
    const response = await app
      .as(account)
      .post('/api/probe-admin/grants')
      .send({ supportRequestId })
      .expect(201);
    return (response.body as OpenedGrantBody).id;
  }

  async function namesUnderGrant(account: TestAccount, grantId: string): Promise<string[]> {
    const response = await app
      .as(account)
      .get(`/api/probe-admin/grants/${grantId}/probes`)
      .expect(200);
    const { items, total } = response.body as { items: ProbeAnswer[]; total: number };
    expect(total).toBe(items.length);
    return items.map((item) => item.name);
  }

  const readUnderGrant = (account: TestAccount, grantId: string, id: string) =>
    answerOf(app.as(account).get(`/api/probe-admin/grants/${grantId}/probes/${id}`));

  async function seed(account: TestAccount, name: string, body: Record<string, unknown> = {}) {
    const response = await app
      .as(account)
      .post('/api/probes')
      .send({ name, ...body })
      .expect(201);
    ids[name] = (response.body as ProbeAnswer).id;
  }

  beforeAll(async () => {
    app = await createIsolationApp(db, [ProbeModule, ProbeAdminModule]);
    const { moduleRef } = app.harness;
    connection = moduleRef.get<Connection>(getConnectionToken());
    await connection.syncIndexes(); // the one-open-grant-per-request index the race relies on
    grants = moduleRef.get(getModelToken(SupportAccessGrantEntity.name));
    logs = moduleRef.get(getModelToken(AdminAccessLogEntity.name));

    app.sources.plans = { [OFFICE_A]: WRITABLE, [OFFICE_B]: WRITABLE };
    [memberA, memberB, investorX, admin, otherAdmin] = await app.signUpAll(
      'member-a',
      'member-b',
      'investor-x',
      'admin',
      'other-admin',
    );
    app.sources
      .forAccount(memberA.id, { memberships: [{ officeId: OFFICE_A }] })
      .forAccount(memberB.id, { memberships: [{ officeId: OFFICE_B }] })
      .forAccount(investorX.id, xLinksActive());
    await app.makeAdmin(admin);
    await app.makeAdmin(otherAdmin);

    const forX = { investorUserId: investorX.id };
    await seed(memberA, 'a-open-x', forX);
    await seed(memberA, 'a-other');
    await seed(memberB, 'b-open-x', forX);
    await seed(memberB, 'b-secret');
    await seed(investorX, 'x-self', forX); // X's own self-advised record
  });

  afterAll(async () => {
    await app.close();
  });

  const X_VIEW = ['a-open-x', 'b-open-x', 'x-self'];
  const A_VIEW = ['a-open-x', 'a-other'];

  it('BR-002-23 / BR-002-24: an admin holding a grant is still refused on every normal client-data route', async () => {
    await openGrant(admin, newRequest(investorX));
    const as = app.as(admin);
    const before = await logs.countDocuments();

    for (const name of ['a-open-x', 'x-self', 'b-secret']) {
      expect(await answerOf(as.get(`/api/probes/${idOf(name)}`))).toEqual(NOT_FOUND);
      expect(await answerOf(as.patch(`/api/probes/${idOf(name)}`).send({ name: 'x' }))).toEqual(
        NOT_FOUND,
      );
      expect(await answerOf(as.delete(`/api/probes/${idOf(name)}`))).toEqual(NOT_FOUND);
    }
    expect((await answerOf(as.get('/api/probes'))).status).toBe(403);
    expect((await answerOf(as.get('/api/probes/as-investor'))).status).toBe(403);
    expect(await logs.countDocuments()).toBe(before); // nothing was read
  });

  it('BR-002-24: no grant without the requester’s permission, for a closed request or an admin requester — the same not-found as a nonexistent request', async () => {
    const nonexistent = await openAnswer(admin, RANDOM_ID);
    expect(nonexistent).toEqual(NOT_FOUND);

    expect(await openAnswer(admin, newRequest(investorX, { dataAccessAllowed: false }))).toEqual(
      nonexistent,
    );
    expect(await openAnswer(admin, newRequest(investorX, { open: false }))).toEqual(nonexistent);
    // BR-002-21: an admin's view is never shown, even with the permission.
    expect(await openAnswer(admin, newRequest(otherAdmin))).toEqual(nonexistent);
    expect(await openAnswer(admin, 'not-an-id')).toEqual(nonexistent);
    expect(await grants.countDocuments({ adminUserId: admin.id, status: 'open' })).toBe(1); // test 1's
  });

  it('BR-002-23: only an admin may open or use a grant', async () => {
    const request = newRequest(investorX);
    expect((await openAnswer(memberA, request)).status).toBe(403);
    const grantId = await openGrant(admin, request);
    expect(
      (await answerOf(app.as(investorX).get(`/api/probe-admin/grants/${grantId}/probes`))).status,
    ).toBe(403);
  });

  it('BR-002-25: under investor X’s grant the admin sees exactly X’s own view, nothing else', async () => {
    const grantId = await openGrant(admin, newRequest(investorX));

    const xOwn = [
      ...(await app.as(investorX).get('/api/probes/as-investor').expect(200)).body.items,
    ].map((item: ProbeAnswer) => item.name);
    expect(xOwn).toEqual(X_VIEW);
    expect(await namesUnderGrant(admin, grantId)).toEqual(X_VIEW);

    for (const name of X_VIEW) {
      const answer = await readUnderGrant(admin, grantId, idOf(name));
      expect(answer.status).toBe(200);
      expect(answer.body).toMatchObject({ id: idOf(name), name });
    }
    // BR-002-12: what X cannot see answers like a random id.
    const missing = await readUnderGrant(admin, grantId, RANDOM_ID);
    expect(missing).toEqual(NOT_FOUND);
    expect(await readUnderGrant(admin, grantId, idOf('a-other'))).toEqual(missing);
    expect(await readUnderGrant(admin, grantId, idOf('b-secret'))).toEqual(missing);
  });

  it('BR-002-25: a grant is read-only — every write through it is refused and nothing changes', async () => {
    const grantId = await openGrant(admin, newRequest(investorX));
    const as = app.as(admin);
    const base = `/api/probe-admin/grants/${grantId}/probes`;
    const attempts = [
      as.post(base).send({ name: 'written by the admin' }),
      as.patch(`${base}/${idOf('x-self')}`).send({ name: 'changed' }),
      as.patch(`${base}/${idOf('a-open-x')}`).send({ name: 'changed' }),
      as.delete(`${base}/${idOf('x-self')}`),
      as.delete(`${base}/${idOf('b-open-x')}`),
    ];
    for (const attempt of attempts) {
      const { status, body } = await answerOf(attempt);
      // Its own record says OFFICE_READ_ONLY (leaks nothing); an investor's record is not found.
      expect([403, 404]).toContain(status);
      expect(['OFFICE_READ_ONLY', 'NOT_FOUND']).toContain((body as { code: string }).code);
    }
    expect(await namesUnderGrant(admin, grantId)).toEqual(X_VIEW);
    const kept = await app
      .as(memberA)
      .get(`/api/probes/${idOf('a-open-x')}`)
      .expect(200);
    expect(kept.body).toMatchObject({ name: 'a-open-x' });
  });

  it('BR-002-25: under a member’s grant the admin sees that office’s data and nothing of other offices', async () => {
    const grantId = await openGrant(admin, newRequest(memberA));

    expect(await namesUnderGrant(admin, grantId)).toEqual(A_VIEW);
    expect(await readUnderGrant(admin, grantId, idOf('b-secret'))).toEqual(NOT_FOUND);
    expect(await readUnderGrant(admin, grantId, idOf('x-self'))).toEqual(NOT_FOUND);
    expect((await readUnderGrant(admin, grantId, idOf('a-other'))).status).toBe(200);
  });

  it('BR-002-25 / AR-13: the grant shows the requester’s CURRENT view (an ended link is gone on the next read)', async () => {
    const grantId = await openGrant(admin, newRequest(investorX));
    app.sources.forAccount(investorX.id, {
      ...xLinksActive(),
      clientLinks: [
        { officeId: OFFICE_A, status: 'ended', endedAt: new Date('2099-01-01T00:00:00Z') },
        { officeId: OFFICE_B, status: 'active' },
      ],
    });
    try {
      expect(await namesUnderGrant(admin, grantId)).toEqual(['b-open-x', 'x-self']);
    } finally {
      app.sources.forAccount(investorX.id, xLinksActive());
    }
  });

  it('BR-002-27: each read produces exactly one log entry with admin, support request, owner, record and time', async () => {
    const supportRequestId = newRequest(investorX);
    const grantId = await openGrant(admin, supportRequestId);
    const mine = { grantId: new Types.ObjectId(grantId) };

    await readUnderGrant(admin, grantId, idOf('a-open-x'));
    const [entry, ...more] = await logs.find(mine).lean().exec();
    expect(more).toEqual([]);
    expect(entry).toMatchObject({
      adminUserId: new Types.ObjectId(admin.id),
      action: 'grant_read',
      supportRequestId: new Types.ObjectId(supportRequestId),
      owner: { type: 'office', id: new Types.ObjectId(OFFICE_A) },
      resource: { type: 'probe', id: new Types.ObjectId(idOf('a-open-x')) },
      at: app.harness.clock.now(),
    });

    // A list logs one entry per record returned; a record not found logs nothing.
    await namesUnderGrant(admin, grantId);
    await readUnderGrant(admin, grantId, idOf('b-secret'));
    const resources = (await logs.find(mine).sort({ _id: 1 }).lean().exec()).map((log) =>
      log.resource?.id.toHexString(),
    );
    expect(resources).toEqual([idOf('a-open-x'), ...X_VIEW.map(idOf)]);
    const owners = await logs.find({ ...mine, 'resource.id': new Types.ObjectId(idOf('x-self')) });
    expect(owners.map((log) => log.owner)).toEqual([
      expect.objectContaining({ type: 'self_advised', id: new Types.ObjectId(investorX.id) }),
    ]);
  });

  it('BR-002-27: a failing log insert blocks the read, and no data is returned', async () => {
    const grantId = await openGrant(admin, newRequest(investorX));
    const db = connection.db;
    if (!db) throw new Error('no database');
    await db.createCollection('adminAccessLogs').catch(() => undefined);
    // Every insert into the log now fails document validation.
    await db.command({
      collMod: 'adminAccessLogs',
      validator: { $jsonSchema: { required: ['a field no entry has'] } },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    const logged = spyOnLogger();
    try {
      const before = await logs.countDocuments();
      const one = await readUnderGrant(admin, grantId, idOf('a-open-x'));
      const list = await answerOf(app.as(admin).get(`/api/probe-admin/grants/${grantId}/probes`));

      expect(one).toEqual(FAULT);
      expect(list).toEqual(FAULT);
      for (const name of X_VIEW) expect(JSON.stringify([one, list])).not.toContain(name);
      expect(await logs.countDocuments()).toBe(before);
      // The refusal is the log's failure (a fault), named without data (SC-15).
      expect(logged.loggedText()).toContain('BR-002-27: admin access log not written (121)');
      expect(logged.loggedText()).toContain('Unhandled AdminAccessLogUnavailableError');
    } finally {
      vi.restoreAllMocks();
      await db.command({ collMod: 'adminAccessLogs', validator: {}, validationLevel: 'off' });
    }
    expect((await readUnderGrant(admin, grantId, idOf('a-open-x'))).status).toBe(200);
  });

  it('BR-002-26: after the support request is closed, the next read is refused and the grant has ended', async () => {
    const supportRequestId = newRequest(investorX);
    const grantId = await openGrant(admin, supportRequestId);
    expect((await readUnderGrant(admin, grantId, idOf('x-self'))).status).toBe(200);

    app.supportRequests.update(supportRequestId, { open: false });

    expect(await readUnderGrant(admin, grantId, idOf('x-self'))).toEqual(NOT_FOUND);
    expect(await grants.findById(grantId).lean().exec()).toMatchObject({
      status: 'ended',
      endReason: 'closed',
      endedAt: app.harness.clock.now(),
    });
    // Ended for good: reopening the request does not revive the grant.
    app.supportRequests.update(supportRequestId, { open: true });
    expect(await readUnderGrant(admin, grantId, idOf('x-self'))).toEqual(NOT_FOUND);
  });

  it('BR-002-26: after the requester withdraws the permission, the next read is refused', async () => {
    const supportRequestId = newRequest(memberA);
    const grantId = await openGrant(admin, supportRequestId);
    expect(await namesUnderGrant(admin, grantId)).toEqual(A_VIEW);

    app.supportRequests.update(supportRequestId, { dataAccessAllowed: false });

    expect(await answerOf(app.as(admin).get(`/api/probe-admin/grants/${grantId}/probes`))).toEqual(
      NOT_FOUND,
    );
    expect(await grants.findById(grantId).lean().exec()).toMatchObject({
      status: 'ended',
      endReason: 'withdrawn',
    });
  });

  it('BR-002-26: SPEC-009 ending the grant (endForSupportRequest) refuses the next read', async () => {
    const supportRequestId = newRequest(investorX);
    const grantId = await openGrant(admin, supportRequestId);

    const service = app.harness.moduleRef.get(SupportGrantService);
    expect(await service.endForSupportRequest(supportRequestId, 'closed')).toBe(true);

    expect(await readUnderGrant(admin, grantId, idOf('x-self'))).toEqual(NOT_FOUND);
  });

  it('BR-002-26: a grant opened 7 days and 1 minute ago is refused even though the request is open', async () => {
    const supportRequestId = newRequest(investorX);
    const grantId = await openGrant(admin, supportRequestId);
    // The grant is moved back in time rather than the clock forward: the admin's 7-day session
    // (BR-001-18) would expire with it and hide the answer behind a 401.
    const openedAt = new Date(app.harness.clock.now().getTime() - (7 * DAY + MINUTE));
    const expiresAt = new Date(openedAt.getTime() + 7 * DAY);
    await grants.collection.updateOne(
      { _id: new Types.ObjectId(grantId) },
      { $set: { openedAt, expiresAt } },
    );

    expect(await readUnderGrant(admin, grantId, idOf('x-self'))).toEqual(NOT_FOUND);
    expect(await grants.findById(grantId).lean().exec()).toMatchObject({
      status: 'ended',
      endReason: 'expired',
      endedAt: expiresAt,
    });
    // The request is still open: a new grant may be opened on it, from now.
    const renewed = await openGrant(admin, supportRequestId);
    expect(renewed).not.toBe(grantId);
    expect((await readUnderGrant(admin, renewed, idOf('x-self'))).status).toBe(200);
  });

  it('DL-002-04: a grant is bound to its admin — another admin gets the not-found of a random grant', async () => {
    const supportRequestId = newRequest(investorX);
    const grantId = await openGrant(admin, supportRequestId);
    const as = app.as(otherAdmin);

    const random = await answerOf(as.get(`/api/probe-admin/grants/${RANDOM_ID}/probes`));
    expect(random).toEqual(NOT_FOUND);
    expect(await answerOf(as.get(`/api/probe-admin/grants/${grantId}/probes`))).toEqual(random);
    expect(await readUnderGrant(otherAdmin, grantId, idOf('x-self'))).toEqual(random);
    // Nor can it open its own on the same request while this one is open.
    expect(await openAnswer(otherAdmin, supportRequestId)).toEqual({
      status: 403,
      body: { code: 'FORBIDDEN', context: {} },
    });
  });

  it('BR-002-24: concurrent opens of the same request produce one grant', async () => {
    const supportRequestId = newRequest(investorX);

    const answers = await Promise.all(
      Array.from({ length: 8 }, () => openAnswer(admin, supportRequestId)),
    );

    expect(answers.map((answer) => answer.status)).toEqual(Array(8).fill(201));
    const grantIds = new Set(answers.map((answer) => (answer.body as OpenedGrantBody).id));
    expect(grantIds.size).toBe(1);
    expect(await grants.countDocuments({ supportRequestId })).toBe(1);
  });
});
