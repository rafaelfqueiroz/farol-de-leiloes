// SPEC-010 BR-010-24..26, DL-010-07 (TS-08): the legal-validation gate and the launch checklist over
// HTTP, on the real AuthModule guards and a real MongoDB. The gate is enforced (LEGAL_GATE_ENFORCED);
// the legal registry is a test one with final texts, a second terms version taking effect later
// (the Clock moves). Records enter the way production's do: the script's command over the insert-only
// repository; nothing in the API writes one.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { aLegalDocument } from '../builders/legal-document.builder.js';
import { LEGAL_DOCUMENTS } from '../../src/privacy/legal/registry.js';
import { LegalValidationModule } from '../../src/privacy/legal-validation/legal-validation.module.js';
import { LegalValidationsRepository } from '../../src/privacy/legal-validation/legal-validations.repository.js';
import { RecordValidationCommand } from '../../src/privacy/legal-validation/record/record-validation.command.js';
import { LegalValidationEntity } from '../../src/privacy/schemas/legal-validation.schema.js';
import { createRetentionLegalIndexes } from '../../src/migrations/0010-retention-legal-indexes.migration.js';
import { useTestDatabase } from '../support/test-database.js';
import { LegalGateProbeModule } from '../support/legal-gate-probe.js';
import {
  createIsolationApp,
  type IsolationApp,
  type TestAccount,
} from '../isolation/support/isolation-app.js';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

// The harness clock starts at 2099-01-15T12:00Z and sessions last 7 days: stay within a day.
const START = new Date('2099-01-15T12:00:00.000Z');
const NEW_TERMS_AT = new Date('2099-01-16T03:00:00.000Z');
const NEW_PRIVACY_AT = new Date('2099-01-16T09:00:00.000Z');
const REGISTRY = [
  aLegalDocument({ type: 'terms', version: '1.0', draft: false }),
  aLegalDocument({ type: 'privacy', version: '1.0', draft: false }),
  aLegalDocument({ type: 'terms', version: '1.1', draft: false, effectiveAt: NEW_TERMS_AT }),
  aLegalDocument({ type: 'privacy', version: '1.1', draft: false, effectiveAt: NEW_PRIVACY_AT }),
];
const DRAFT_REGISTRY = [
  aLegalDocument({ type: 'terms', version: '0.1', draft: true }),
  aLegalDocument({ type: 'privacy', version: '0.1', draft: true }),
];

async function bootApp(
  db: ReturnType<typeof useTestDatabase>,
  env: Record<string, string>,
  registry = REGISTRY,
): Promise<IsolationApp> {
  return createIsolationApp(
    db,
    [LegalGateProbeModule, LegalValidationModule],
    env,
    undefined,
    (builder) => builder.overrideProvider(LEGAL_DOCUMENTS).useValue(registry),
  );
}

describe('the gate and the checklist, enforced (LEGAL_GATE_ENFORCED=true)', () => {
  const db = useTestDatabase();
  let app: IsolationApp;
  let user: TestAccount;
  let admin: TestAccount;
  let command: RecordValidationCommand;
  let records: Model<unknown>;

  const record = (input: Parameters<RecordValidationCommand['run']>[0]) => command.run(input);
  const get = (account: TestAccount, path: string): request.Test => app.as(account).get(path);
  const checklist = async () => (await get(admin, '/api/admin/launch-checklist').expect(200)).body;

  beforeAll(async () => {
    app = await bootApp(db, { LEGAL_GATE_ENFORCED: 'true' });
    const moduleRef = app.harness.moduleRef;
    const connection = moduleRef.get<Connection>(getConnectionToken());
    await createRetentionLegalIndexes(connection.db as never);
    records = moduleRef.get(getModelToken(LegalValidationEntity.name));
    command = new RecordValidationCommand(
      moduleRef.get(LegalValidationsRepository),
      app.harness.clock,
      REGISTRY,
    );
    [user, admin] = await app.signUpAll('gate-user', 'gate-admin');
    await app.makeAdmin(admin as TestAccount);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('@RequiresLegalValidation (BR-010-25)', () => {
    it('answers 401 to an anonymous request, even where the controller is @Public() (SC-07)', async () => {
      const supertest = (await import('supertest')).default;
      const server = app.harness.app.getHttpServer() as Parameters<typeof supertest>[0];
      await supertest(server).get('/api/legal-gate-probe/third-party').expect(401);
      await supertest(server).get('/api/legal-gate-public-probe/gated').expect(401);
      await supertest(server).get('/api/legal-gate-public-probe/open').expect(200);
    });

    it('refuses with 403 LEGAL_VALIDATION_REQUIRED and only the scope while no validation is recorded', async () => {
      for (const [path, scope] of [
        ['/api/legal-gate-probe/third-party', 'third-party-processing'],
        ['/api/legal-gate-probe/terms', 'terms'],
        ['/api/legal-gate-public-probe/gated', 'third-party-processing'],
      ] as const) {
        const response = await get(user, path).expect(403);
        expect(response.body).toEqual({ code: 'LEGAL_VALIDATION_REQUIRED', context: { scope } });
      }
    });

    it('leaves a route without the decorator alone', async () => {
      await get(user, '/api/legal-gate-probe/open').expect(200);
    });

    it('lets the request through once the validation is recorded, on the next request', async () => {
      await get(user, '/api/legal-gate-probe/third-party').expect(403);

      await record({
        scope: 'third-party-processing',
        validator: 'Dra. Fulana de Tal',
        versions: [],
      });

      await get(user, '/api/legal-gate-probe/third-party').expect(200);
      await get(user, '/api/legal-gate-public-probe/gated').expect(200);
      // The other scope is a different gate.
      await get(user, '/api/legal-gate-probe/terms').expect(403);
    });

    it('reopens the terms gate when a new version of the terms takes effect', async () => {
      await record({ scope: 'terms', validator: 'Dra. Fulana de Tal', versions: ['terms:1.0'] });
      await get(user, '/api/legal-gate-probe/terms').expect(200);

      app.harness.clock.set(new Date(NEW_TERMS_AT.getTime() - 1));
      await get(user, '/api/legal-gate-probe/terms').expect(200);
      app.harness.clock.set(NEW_TERMS_AT); // terms 1.1 is now in force
      const refused = await get(user, '/api/legal-gate-probe/terms').expect(403);
      expect(refused.body).toEqual({
        code: 'LEGAL_VALIDATION_REQUIRED',
        context: { scope: 'terms' },
      });

      await record({ scope: 'terms', validator: 'Dra. Fulana de Tal', versions: ['terms:1.1'] });
      await get(user, '/api/legal-gate-probe/terms').expect(200);
      // The third-party validation does not depend on a document version.
      await get(user, '/api/legal-gate-probe/third-party').expect(200);
      app.harness.clock.set(START);
    });

    it('fails closed when the validations cannot be read', async () => {
      const repository = app.harness.moduleRef.get(LegalValidationsRepository);
      const spy = vi
        .spyOn(repository, 'newestOfScope')
        .mockRejectedValue(new Error('connection to mongodb://secret@host lost'));
      try {
        const response = await get(user, '/api/legal-gate-probe/third-party').expect(403);
        expect(response.body).toEqual({
          code: 'LEGAL_VALIDATION_REQUIRED',
          context: { scope: 'third-party-processing' },
        });
        expect(JSON.stringify(response.body)).not.toContain('secret');
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('the records are insert-only and nothing in the API writes one (BR-010-25, BR-010-26)', () => {
    it('stores the scope, date, validator and versions, and refuses an update or a delete', async () => {
      const stored = await records.collection.find({ scope: 'terms' }).sort({ _id: 1 }).toArray();
      expect(stored.length).toBeGreaterThanOrEqual(2);
      expect(stored[0]).toMatchObject({
        scope: 'terms',
        validatorName: 'Dra. Fulana de Tal',
        documentVersions: ['terms:1.0'],
      });
      await expect(records.updateOne({}, { $set: { scope: 'terms' } })).rejects.toThrow(
        'insert-only',
      );
      await expect(records.deleteMany({})).rejects.toThrow('insert-only');
    });

    it('has no route that writes a validation: every write verb answers 404 (or 405)', async () => {
      for (const path of [
        '/api/admin/launch-checklist',
        '/api/admin/legal-validations',
        '/api/privacy/legal-validations',
        '/api/legal/validations',
      ]) {
        for (const method of ['post', 'patch', 'delete'] as const) {
          const response = await app.as(admin)[method](path);
          expect([404, 405], `${method} ${path}`).toContain(response.status);
        }
      }
    });
  });

  describe('GET /api/admin/launch-checklist (BR-010-24..26)', () => {
    it('is admin only: 401 without a session, 403 for an ordinary account', async () => {
      const supertest = (await import('supertest')).default;
      const server = app.harness.app.getHttpServer() as Parameters<typeof supertest>[0];
      await supertest(server).get('/api/admin/launch-checklist').expect(401);
      const response = await get(user, '/api/admin/launch-checklist').expect(403);
      expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
    });

    it('is never cached', async () => {
      const response = await get(admin, '/api/admin/launch-checklist').expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('shows blocked gates, the retention as provisional and launchReady false, with partial records', async () => {
      // Recorded so far: third-party-processing and terms 1.0 and 1.1; privacy and retention are missing.
      const body = await checklist();

      expect(body.launchReady).toBe(false);
      const byScope = Object.fromEntries(
        (body.gates as { scope: string; validated: boolean; blocks: string[] }[]).map((gate) => [
          gate.scope,
          gate,
        ]),
      );
      expect(byScope['third-party-processing']).toMatchObject({ validated: true });
      expect(byScope['third-party-processing']?.blocks).toContain('SPEC-015 manual legal analysis');
      expect(byScope['retention-periods']).toMatchObject({ validated: false });
      expect(byScope['privacy-policy']).toMatchObject({ validated: false });
      expect(body.retention).toEqual({ documentYears: 5, provisional: true });
      expect(body.drafts).toEqual([]);
      expect(body.settings).toMatchObject({
        legalGateEnforced: true,
        privateBucketConfigured: false,
      });
      expect(body.lawyerSetPeriods).toHaveLength(3);
      for (const period of body.lawyerSetPeriods) expect(period.deleted).toBe(false);
    });

    it('is ready only with all four validations on non-draft current documents, and carries no validator', async () => {
      await record({
        scope: 'privacy-policy',
        validator: 'Dra. Fulana de Tal',
        versions: ['privacy:1.0'],
      });
      await record({
        scope: 'retention-periods',
        validator: 'Dra. Fulana de Tal',
        versions: [],
        retentionYears: 5,
        reference: 'parecer-77',
      });
      // terms 1.1 is not in force at the harness clock's start, and 1.0 was validated.
      app.harness.clock.set(START);

      const body = await checklist();

      expect(body.launchReady).toBe(true);
      expect(body.retention.provisional).toBe(false);
      expect(body.gates.every((gate: { validated: boolean }) => gate.validated)).toBe(true);
      const text = JSON.stringify(body);
      expect(text).not.toContain('Fulana');
      expect(text).not.toContain('parecer-77');
    });

    it('is reopened when a new version of a document takes effect, and ready again once it is validated', async () => {
      app.harness.clock.set(new Date(NEW_PRIVACY_AT.getTime() + 60_000)); // privacy 1.1 takes effect
      const reopened = await checklist();
      expect(reopened.launchReady).toBe(false);
      const gate = (body: { gates: { scope: string; validated: boolean }[] }, scope: string) =>
        body.gates.find((g) => g.scope === scope)?.validated;
      expect(gate(reopened, 'privacy-policy')).toBe(false);
      expect(gate(reopened, 'terms')).toBe(true); // terms 1.1 was validated above
      expect(gate(reopened, 'retention-periods')).toBe(true); // does not depend on a text

      await record({
        scope: 'privacy-policy',
        validator: 'Dra. Fulana de Tal',
        versions: ['privacy:1.1'],
      });

      const ready = await checklist();
      expect(gate(ready, 'privacy-policy')).toBe(true);
      expect(ready.launchReady).toBe(true);
      app.harness.clock.set(START);
    });
  });
});

describe('the gate is open where it is not enforced (LEGAL_GATE_ENFORCED=false)', () => {
  const db = useTestDatabase();
  let app: IsolationApp;
  let user: TestAccount;

  beforeAll(async () => {
    app = await bootApp(db, { LEGAL_GATE_ENFORCED: 'false', NODE_ENV: 'test' });
    [user] = await app.signUpAll('open-gate');
  });

  afterAll(async () => {
    await app.close();
  });

  it('passes without any record', async () => {
    await app.as(user).get('/api/legal-gate-probe/third-party').expect(200);
    await app.as(user).get('/api/legal-gate-probe/terms').expect(200);
  });
});

describe('the launch checklist with the placeholder texts (drafts)', () => {
  const db = useTestDatabase();
  let app: IsolationApp;
  let admin: TestAccount;

  beforeAll(async () => {
    app = await bootApp(db, { LEGAL_GATE_ENFORCED: 'true' }, DRAFT_REGISTRY);
    [admin] = await app.signUpAll('draft-admin');
    await app.makeAdmin(admin);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists both current documents as drafts and is not ready', async () => {
    const body = (await app.as(admin).get('/api/admin/launch-checklist').expect(200)).body;

    expect(body.drafts).toEqual([
      { type: 'terms', version: '0.1' },
      { type: 'privacy', version: '0.1' },
    ]);
    expect(body.launchReady).toBe(false);
  });

  it('a draft placeholder cannot be validated by the script: nothing is written', async () => {
    const moduleRef = app.harness.moduleRef;
    const command = new RecordValidationCommand(
      moduleRef.get(LegalValidationsRepository),
      app.harness.clock,
      DRAFT_REGISTRY,
    );

    const outcome = await command.run({
      scope: 'terms',
      validator: 'Dra. Fulana de Tal',
      versions: ['terms:0.1'],
    });

    expect(outcome).toMatchObject({ result: 'refused' });
    const body = (await app.as(admin).get('/api/admin/launch-checklist').expect(200)).body;
    expect(body.gates.find((gate: { scope: string }) => gate.scope === 'terms').validated).toBe(
      false,
    );
  });
});
