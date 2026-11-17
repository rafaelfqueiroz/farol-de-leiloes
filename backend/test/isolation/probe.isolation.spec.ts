// SPEC-002 TS-13..TS-18: the acceptance criteria the owner-scoping framework can prove before any
// real owned collection exists, through the HTTP API on the PROBE collection (support/probe.module.ts):
// the real OwnerScopedRepository, AccessContext, guards and error filter; only the relationships
// (memberships, client links, self-advised status, office plans) come from fakes the spec sets per
// account (TS-03), read on every request like the real sources (BR-002-15).
//
// The cast: offices A and B share investor X (TS-16); C has a client whose invitation to A is
// still pending; R is read-only (its plan lapsed, BR-002-30). Each test names its rule.
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { ClientLink } from '../../src/access/sources/client-link.source.js';
import type { OfficePlanState } from '../../src/access/sources/office-plan.source.js';
import { useTestDatabase } from '../support/test-database.js';
import {
  type Answer,
  answerOf,
  createIsolationApp,
  type IsolationApp,
  RANDOM_ID,
  type TestAccount,
} from './support/isolation-app.js';
import { isolationSpecFor } from './support/isolation-spec.js';
import { PROBE_ENTITLEMENT, ProbeModule, type ProbeAnswer } from './support/probe.module.js';

const OFFICE_A = '64b7f00000000000000a0a0a';
const OFFICE_B = '64b7f00000000000000b0b0b';
const OFFICE_C = '64b7f00000000000000c0c0c';
const OFFICE_R = '64b7f00000000000000e0e0e';
const OFFICE_ELSEWHERE = '64b7f00000000000000f0f0f';

const WRITABLE: OfficePlanState = {
  advisorPlanActive: true,
  readOnly: false,
  entitlements: [PROBE_ENTITLEMENT],
};
// BR-012-28 / D-47: lapsed beyond the grace period: reads stay, writes are refused.
const READ_ONLY: OfficePlanState = { ...WRITABLE, advisorPlanActive: false, readOnly: true };

const CLOSED_BEFORE_END = '2026-03-01T12:00:00.000Z';
const LINK_ENDED = new Date('2026-04-01T12:00:00.000Z');
const CLOSED_AFTER_END = '2026-06-01T12:00:00.000Z';

const NOT_FOUND: Answer = { status: 404, body: { code: 'NOT_FOUND', context: {} } };

isolationSpecFor('ProbeEntity', () => {
  const db = useTestDatabase();
  let app: IsolationApp;
  const ids: Record<string, string> = {};
  let memberA: TestAccount;
  let memberB: TestAccount;
  let memberC: TestAccount;
  let memberAB: TestAccount;
  let memberR: TestAccount;
  let memberRA: TestAccount;
  let investorX: TestAccount;
  let pendingY: TestAccount;
  let admin: TestAccount;

  const membersOf = (...officeIds: string[]) => ({
    memberships: officeIds.map((officeId) => ({ officeId })),
  });
  const xLinks = (): ClientLink[] => [
    { officeId: OFFICE_A, status: 'active' },
    { officeId: OFFICE_B, status: 'active' },
  ];
  const investorX_relationships = (clientLinks: ClientLink[] = xLinks()) => ({
    clientLinks,
    selfAdvised: true,
    selfAdvisedEntitlements: [PROBE_ENTITLEMENT],
  });

  async function seed(account: TestAccount, name: string, body: Record<string, unknown> = {}) {
    const response = await app
      .as(account)
      .post('/api/probes')
      .send({ name, ...body })
      .expect(201);
    ids[name] = (response.body as ProbeAnswer).id;
  }

  async function namesListedBy(account: TestAccount, path = '/api/probes'): Promise<string[]> {
    const response = await app.as(account).get(path).expect(200);
    const { items, total } = response.body as { items: ProbeAnswer[]; total: number };
    expect(total).toBe(items.length);
    return items.map((item) => item.name);
  }

  const idOf = (name: string) => ids[name] ?? '';

  beforeAll(async () => {
    app = await createIsolationApp(db, [ProbeModule]);
    const { sources } = app;
    sources.plans = {
      [OFFICE_A]: WRITABLE,
      [OFFICE_B]: WRITABLE,
      [OFFICE_C]: WRITABLE,
      [OFFICE_R]: WRITABLE, // made read-only once seeded
    };
    [memberA, memberB, memberC, memberAB, memberR, memberRA, investorX, pendingY, admin] =
      await app.signUpAll(
        'member-a',
        'member-b',
        'member-c',
        'member-ab',
        'member-r',
        'member-ra',
        'investor-x',
        'pending-y',
        'admin',
      );
    sources
      .forAccount(memberA.id, membersOf(OFFICE_A))
      .forAccount(memberB.id, membersOf(OFFICE_B))
      .forAccount(memberC.id, membersOf(OFFICE_C))
      .forAccount(memberAB.id, membersOf(OFFICE_A, OFFICE_B))
      .forAccount(memberR.id, membersOf(OFFICE_R))
      .forAccount(memberRA.id, membersOf(OFFICE_R, OFFICE_A))
      .forAccount(investorX.id, investorX_relationships())
      .forAccount(pendingY.id, {
        // D-45: a source should never return a pending link; the context drops one anyway.
        clientLinks: [
          { officeId: OFFICE_A, status: 'pending' } as unknown as ClientLink,
          { officeId: OFFICE_C, status: 'active' },
        ],
      })
      // BR-002-21: an admin is nobody's member, whatever a source says (fails closed).
      .forAccount(admin.id, membersOf(OFFICE_A));
    await app.makeAdmin(admin);

    const forX = { investorUserId: investorX.id };
    await seed(memberA, 'a-open-x', forX);
    await seed(memberA, 'a-closed-x', { ...forX, status: 'closed', closedAt: CLOSED_BEFORE_END });
    await seed(memberA, 'a-closed-late-x', {
      ...forX,
      status: 'closed',
      closedAt: CLOSED_AFTER_END,
    });
    await seed(memberA, 'a-other');
    await seed(memberA, 'a-pending-y', { investorUserId: pendingY.id });
    await seed(memberB, 'b-open-x', forX);
    await seed(memberB, 'b-secret');
    await seed(memberC, 'c-y', { investorUserId: pendingY.id });
    await seed(investorX, 'x-self', forX); // X's own self-advised record
    await seed(memberR, 'r-record');
    sources.plans[OFFICE_R] = READ_ONLY;
  });

  afterAll(async () => {
    await app.close();
  });

  const A_NAMES = ['a-closed-late-x', 'a-closed-x', 'a-open-x', 'a-other', 'a-pending-y'];

  it('BR-002-03 / BR-002-04 / TS-16: a member of A lists and counts A’s records only', async () => {
    expect(await namesListedBy(memberA)).toEqual(A_NAMES);
    expect(await namesListedBy(memberB)).toEqual(['b-open-x', 'b-secret']);
    expect(await namesListedBy(memberA, '/api/probes?status=closed')).toEqual([
      'a-closed-late-x',
      'a-closed-x',
    ]);
  });

  it('BR-002-12 / TS-17: B’s id answers A’s member exactly like a random id, read or write', async () => {
    const as = app.as(memberA);
    for (const [foreign, missing] of [
      [as.get(`/api/probes/${idOf('b-secret')}`), as.get(`/api/probes/${RANDOM_ID}`)],
      [
        as.patch(`/api/probes/${idOf('b-secret')}`).send({ name: 'taken' }),
        as.patch(`/api/probes/${RANDOM_ID}`).send({ name: 'taken' }),
      ],
      [as.delete(`/api/probes/${idOf('b-secret')}`), as.delete(`/api/probes/${RANDOM_ID}`)],
    ] as const) {
      const [foreignAnswer, missingAnswer] = [await answerOf(foreign), await answerOf(missing)];
      expect(foreignAnswer).toEqual(missingAnswer);
      expect(foreignAnswer).toEqual(NOT_FOUND);
    }
    expect(await answerOf(as.get('/api/probes/not-an-id'))).toEqual(NOT_FOUND);
    // B's record is untouched.
    const kept = await app
      .as(memberB)
      .get(`/api/probes/${idOf('b-secret')}`)
      .expect(200);
    expect(kept.body).toMatchObject({ name: 'b-secret', ownerId: OFFICE_B });
  });

  it('BR-002-11 / TS-17: B’s office id in the body, query or a header acts on A or on nothing', async () => {
    const as = app.as(memberA);

    expect(
      await answerOf(as.post('/api/probes').send({ name: 'planted', officeId: OFFICE_B })),
    ).toEqual(NOT_FOUND);
    expect(await answerOf(as.get(`/api/probes?officeId=${OFFICE_B}`))).toEqual(NOT_FOUND);
    expect(await answerOf(as.get(`/api/probes/offices/${OFFICE_B}`))).toEqual(
      await answerOf(as.get(`/api/probes/offices/${OFFICE_ELSEWHERE}`)),
    );
    const viaHeader = await as.get('/api/probes').set('X-Office-Id', OFFICE_B).expect(200);
    expect((viaHeader.body as { items: ProbeAnswer[] }).items.map((i) => i.name)).toEqual(A_NAMES);

    // Owner fields are no part of any request: refused, nothing written.
    for (const planted of [
      { ownerId: OFFICE_B },
      { ownerType: 'office', ownerId: OFFICE_B },
      { userId: memberB.id },
    ]) {
      const refused = await as
        .post('/api/probes')
        .send({ name: 'planted', ...planted })
        .expect(400);
      expect(refused.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    await as.get(`/api/probes?ownerId=${OFFICE_B}`).expect(400);
    expect(await namesListedBy(memberB)).toEqual(['b-open-x', 'b-secret']);
    expect(await namesListedBy(memberA)).toEqual(A_NAMES);
  });

  it('BR-002-11: a member of A and B acts only on an office they are in, and must say which', async () => {
    const as = app.as(memberAB);

    expect(await namesListedBy(memberAB)).toEqual([...A_NAMES, 'b-open-x', 'b-secret'].sort());
    expect(await namesListedBy(memberAB, `/api/probes/offices/${OFFICE_B}`)).toEqual([
      'b-open-x',
      'b-secret',
    ]);
    expect(await answerOf(as.get(`/api/probes/offices/${OFFICE_C}`))).toEqual(NOT_FOUND);
    expect(
      await answerOf(as.post('/api/probes').send({ name: 'planted', officeId: OFFICE_C })),
    ).toEqual(NOT_FOUND);
    const ambiguous = await as.post('/api/probes').send({ name: 'which?' }).expect(400);
    expect(ambiguous.body).toEqual({
      code: 'VALIDATION_FAILED',
      context: { fields: ['officeId'] },
    });
    expect(await namesListedBy(memberC)).toEqual(['c-y']);
  });

  it('BR-002-05: investor X reads A’s, B’s and their own self-advised records in one list', async () => {
    expect(await namesListedBy(investorX, '/api/probes/as-investor')).toEqual([
      'a-closed-late-x',
      'a-closed-x',
      'a-open-x',
      'b-open-x',
      'x-self',
    ]);
    // As the conducting party of their own journeys, X sees only those.
    expect(await namesListedBy(investorX)).toEqual(['x-self']);
  });

  it('BR-002-06: investor X cannot change or delete A’s record, nor create one for A', async () => {
    const as = app.as(investorX);
    const id = idOf('a-open-x');

    expect(await answerOf(as.patch(`/api/probes/${id}`).send({ status: 'closed' }))).toEqual(
      await answerOf(as.patch(`/api/probes/${RANDOM_ID}`).send({ status: 'closed' })),
    );
    expect(await answerOf(as.delete(`/api/probes/${id}`))).toEqual(NOT_FOUND);
    expect(
      await answerOf(as.post('/api/probes').send({ name: 'mine now', officeId: OFFICE_A })),
    ).toEqual(NOT_FOUND);
    const kept = await app.as(memberA).get(`/api/probes/${id}`).expect(200);
    expect(kept.body).toMatchObject({ name: 'a-open-x', status: 'open' });
  });

  it('BR-002-02 / RF-CON-11: X’s self-advised records are invisible to A, an office X is a client of', async () => {
    const as = app.as(memberA);

    expect(await answerOf(as.get(`/api/probes/${idOf('x-self')}`))).toEqual(NOT_FOUND);
    expect(await namesListedBy(memberA)).not.toContain('x-self');
  });

  it('D-45: a pending invitation grants nothing of A; an active link with C still counts', async () => {
    expect(await namesListedBy(pendingY, '/api/probes/as-investor')).toEqual(['c-y']);

    app.sources.forAccount(pendingY.id, {
      clientLinks: [{ officeId: OFFICE_A, status: 'pending' } as unknown as ClientLink],
    });
    try {
      const refused = await app.as(pendingY).get('/api/probes/as-investor').expect(403);
      expect(refused.body).toEqual({
        code: 'PERSONA_REQUIRED',
        context: { personas: ['investor'] },
      });
    } finally {
      app.sources.forAccount(pendingY.id, {
        clientLinks: [
          { officeId: OFFICE_A, status: 'pending' } as unknown as ClientLink,
          { officeId: OFFICE_C, status: 'active' },
        ],
      });
    }
  });

  it('BR-002-07 / TS-18: when the link with A ends, X loses A’s in-progress records at once and keeps those closed before the end', async () => {
    app.sources.forAccount(
      investorX.id,
      investorX_relationships([
        { officeId: OFFICE_A, status: 'ended', endedAt: LINK_ENDED },
        { officeId: OFFICE_B, status: 'active' },
      ]),
    );
    try {
      expect(await namesListedBy(investorX, '/api/probes/as-investor')).toEqual([
        'a-closed-x',
        'b-open-x',
        'x-self',
      ]);
    } finally {
      app.sources.forAccount(investorX.id, investorX_relationships());
    }
    expect(await namesListedBy(investorX, '/api/probes/as-investor')).toContain('a-open-x');
  });

  it('BR-002-15 / BR-002-16 / TS-18: a member removed from A mid-session is refused A’s records on the next request', async () => {
    const as = app.as(memberAB);
    await as.get(`/api/probes/${idOf('a-other')}`).expect(200);

    app.sources.forAccount(memberAB.id, membersOf(OFFICE_B)); // removed from A, same session
    try {
      expect(await answerOf(as.get(`/api/probes/${idOf('a-other')}`))).toEqual(NOT_FOUND);
      expect(
        await answerOf(as.patch(`/api/probes/${idOf('a-other')}`).send({ name: 'x' })),
      ).toEqual(NOT_FOUND);
      expect(await namesListedBy(memberAB)).toEqual(['b-open-x', 'b-secret']);
      expect(await answerOf(as.get(`/api/probes/offices/${OFFICE_A}`))).toEqual(NOT_FOUND);
    } finally {
      app.sources.forAccount(memberAB.id, membersOf(OFFICE_A, OFFICE_B));
    }
  });

  it('BR-002-30: a read-only office reads, and every write to it is refused with OFFICE_READ_ONLY', async () => {
    const id = idOf('r-record');
    const readOnly = { code: 'OFFICE_READ_ONLY', context: {} };

    expect(await namesListedBy(memberR)).toEqual(['r-record']);
    await app.as(memberR).get(`/api/probes/${id}`).expect(200);
    // The guard refuses a write route outright when only read-only offices hold the entitlement.
    const created = await app.as(memberR).post('/api/probes').send({ name: 'new' }).expect(403);
    expect(created.body).toEqual({
      code: 'OFFICE_READ_ONLY',
      context: { entitlement: PROBE_ENTITLEMENT },
    });
    // The repository refuses the record writes (its own record: saying so leaks nothing).
    for (const account of [memberR, memberRA]) {
      const as = app.as(account);
      expect(await answerOf(as.patch(`/api/probes/${id}`).send({ name: 'changed' }))).toEqual({
        status: 403,
        body: readOnly,
      });
      expect(await answerOf(as.delete(`/api/probes/${id}`))).toEqual({
        status: 403,
        body: readOnly,
      });
    }
    // A member of R and A: A is writable, R is not.
    expect(
      await answerOf(
        app.as(memberRA).post('/api/probes').send({ name: 'new', officeId: OFFICE_R }),
      ),
    ).toEqual({ status: 403, body: readOnly });
    await app
      .as(memberRA)
      .patch(`/api/probes/${idOf('a-other')}`)
      .send({ name: 'a-other' })
      .expect(200);
    // Another office learns nothing from R's state: the record is simply not there.
    expect(
      await answerOf(app.as(memberB).patch(`/api/probes/${id}`).send({ name: 'changed' })),
    ).toEqual(NOT_FOUND);
    const kept = await app.as(memberR).get(`/api/probes/${id}`).expect(200);
    expect(kept.body).toMatchObject({ name: 'r-record' });
  });

  it('BR-002-23 / SC-09: an admin is refused on every probe route, read or write; records answer like missing ones', async () => {
    const as = app.as(admin);
    const id = idOf('a-other');

    expect(await answerOf(as.get(`/api/probes/${id}`))).toEqual(NOT_FOUND);
    expect(await answerOf(as.get(`/api/probes/admin/${id}`))).toEqual(
      await answerOf(as.get(`/api/probes/admin/${RANDOM_ID}`)),
    );
    expect(await answerOf(as.get(`/api/probes/admin/${id}`))).toEqual(NOT_FOUND);
    expect(await answerOf(as.patch(`/api/probes/${id}`).send({ name: 'admin' }))).toEqual(
      NOT_FOUND,
    );
    expect(await answerOf(as.delete(`/api/probes/${id}`))).toEqual(NOT_FOUND);
    expect(await answerOf(as.get(`/api/probes/offices/${OFFICE_A}`))).toMatchObject({
      status: 403,
    });
    expect((await answerOf(as.get('/api/probes'))).status).toBe(403);
    expect((await answerOf(as.post('/api/probes').send({ name: 'admin' }))).status).toBe(403);
    expect((await answerOf(as.get('/api/probes/as-investor'))).status).toBe(403);
    expect(await namesListedBy(memberA)).toEqual(A_NAMES);
  });
});
