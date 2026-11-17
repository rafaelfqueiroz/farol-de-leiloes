// SPEC-002 BR-002-13 / AR-15 / TS-13: the plan-limit counters (ownerCounters) are owned per office:
// one office's count never moves another's, and no request can push an owner past its limit —
// proven through the PROBE routes (support/probe.module.ts), which count their records with
// OwnerCounterRepository. The collection joins the API with SPEC-016; the gate then requires this.
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { OfficePlanState } from '../../src/access/sources/office-plan.source.js';
import { useTestDatabase } from '../support/test-database.js';
import {
  answerOf,
  createIsolationApp,
  type IsolationApp,
  RANDOM_ID,
  type TestAccount,
} from './support/isolation-app.js';
import { isolationSpecFor } from './support/isolation-spec.js';
import { PROBE_ENTITLEMENT, PROBE_LIMIT, ProbeModule } from './support/probe.module.js';

const OFFICE_P = '64b7f0000000000000010101';
const OFFICE_Q = '64b7f0000000000000020202';
const OFFICE_S = '64b7f0000000000000030303';
const WRITABLE: OfficePlanState = {
  advisorPlanActive: true,
  readOnly: false,
  entitlements: [PROBE_ENTITLEMENT],
};
const LIMIT_REACHED = { status: 403, body: { code: 'PLAN_NOT_ALLOWED', context: { limit: 10 } } };

isolationSpecFor('OwnerCounterEntity', () => {
  const db = useTestDatabase();
  let app: IsolationApp;
  let memberP: TestAccount;
  let memberQ: TestAccount;
  let memberS: TestAccount;

  const create = (account: TestAccount, name: string) =>
    answerOf(app.as(account).post('/api/probes').send({ name }));

  beforeAll(async () => {
    app = await createIsolationApp(db, [ProbeModule]);
    app.sources.plans = { [OFFICE_P]: WRITABLE, [OFFICE_Q]: WRITABLE, [OFFICE_S]: WRITABLE };
    [memberP, memberQ, memberS] = await app.signUpAll('member-p', 'member-q', 'member-s');
    app.sources
      .forAccount(memberP.id, { memberships: [{ officeId: OFFICE_P }] })
      .forAccount(memberQ.id, { memberships: [{ officeId: OFFICE_Q }] })
      .forAccount(memberS.id, { memberships: [{ officeId: OFFICE_S }] });
  });

  afterAll(async () => {
    await app.close();
  });

  it('BR-002-13: an office at its limit is refused; another office’s count is its own', async () => {
    expect(PROBE_LIMIT).toBe(10);
    for (let n = 1; n <= PROBE_LIMIT; n += 1) {
      expect((await create(memberP, `p-${n}`)).status).toBe(201);
    }
    expect(await create(memberP, 'p-over')).toEqual(LIMIT_REACHED);

    // Q is untouched by P's count, and P's member cannot free P's slot with Q's record or Q's
    // slot with P's: a foreign id is just not found (BR-002-12).
    const q = await create(memberQ, 'q-1');
    expect(q.status).toBe(201);
    const qId = (q.body as { id: string }).id;
    expect(await answerOf(app.as(memberP).delete(`/api/probes/${qId}`))).toEqual(
      await answerOf(app.as(memberP).delete(`/api/probes/${RANDOM_ID}`)),
    );
    expect(await create(memberP, 'p-still-over')).toEqual(LIMIT_REACHED);
    for (let n = 2; n <= PROBE_LIMIT; n += 1) {
      expect((await create(memberQ, `q-${n}`)).status).toBe(201);
    }
    expect(await create(memberQ, 'q-over')).toEqual(LIMIT_REACHED);
  });

  it('BR-002-13: deleting one of its own records gives the office its slot back', async () => {
    const listed = await app.as(memberP).get('/api/probes').expect(200);
    const [first] = (listed.body as { items: { id: string }[] }).items;
    await app
      .as(memberP)
      .delete(`/api/probes/${first?.id ?? ''}`)
      .expect(204);

    expect((await create(memberP, 'p-again')).status).toBe(201);
    expect(await create(memberP, 'p-over-again')).toEqual(LIMIT_REACHED);
  });

  it('BR-002-13 / AR-15: concurrent creates one below the limit give exactly one success', async () => {
    for (let n = 1; n < PROBE_LIMIT; n += 1) {
      expect((await create(memberS, `s-${n}`)).status).toBe(201);
    }

    const answers = await Promise.all(
      Array.from({ length: 8 }, (_, n) => create(memberS, `s-race-${n}`)),
    );

    expect(answers.filter((answer) => answer.status === 201)).toHaveLength(1);
    expect(answers.filter((answer) => answer.status === 403)).toHaveLength(7);
    const listed = await app.as(memberS).get('/api/probes').expect(200);
    expect((listed.body as { total: number }).total).toBe(PROBE_LIMIT);
  });
});
