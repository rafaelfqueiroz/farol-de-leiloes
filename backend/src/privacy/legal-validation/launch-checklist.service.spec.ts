// SPEC-010 BR-010-24..26: the checklist assembled from the live state, over the fakes (TS-03). The
// endpoint, its guards and the whole flow are test/integration/legal-validation.spec.ts.
import { describe, expect, it } from 'vitest';
import { aLegalDocument } from '../../../test/builders/legal-document.builder.js';
import { FakeClock } from '../../../test/fakes/fake-clock.js';
import { FakeLegalValidationsRepository } from '../../../test/fakes/fake-privacy-repositories.js';
import { testBusinessConfig, testConfigService } from '../../../test/support/test-env.js';
import { schedulerConfigFrom } from '../../config/scheduler.config.js';
import { testEnv } from '../../../test/support/test-env.js';
import { LegalDocumentsService } from '../legal-documents.service.js';
import { LaunchChecklistService } from './launch-checklist.service.js';
import { LegalValidationService } from './legal-validation.service.js';

const NOW = new Date('2026-06-01T12:00:00.000Z');
const FINAL = [
  aLegalDocument({ type: 'terms', version: '1.0', draft: false }),
  aLegalDocument({ type: 'privacy', version: '1.0', draft: false }),
];

function build(options: { env?: Record<string, string>; registry?: typeof FINAL } = {}) {
  const env = options.env ?? {};
  const repo = new FakeLegalValidationsRepository();
  const documents = new LegalDocumentsService(options.registry ?? FINAL, new FakeClock(NOW));
  const business = testBusinessConfig(env);
  const validation = new LegalValidationService(repo as never, documents, business);
  const service = new LaunchChecklistService(
    validation,
    documents,
    testConfigService(env),
    business,
    schedulerConfigFrom(testEnv(env)),
  );
  return { service, repo };
}

const record = (
  repo: FakeLegalValidationsRepository,
  scope: Parameters<typeof repo.insert>[0]['scope'],
  extra = {},
) =>
  repo.insert({
    scope,
    validatedAt: NOW,
    validatorName: 'Dra. Segredo',
    documentVersions: [],
    ...extra,
  });

describe('LaunchChecklistService', () => {
  it('without records: blocked gates, provisional periods, not ready', async () => {
    const { service } = build();

    const checklist = await service.checklist();

    expect(checklist.launchReady).toBe(false);
    expect(checklist.gates.every((gate) => !gate.validated)).toBe(true);
    expect(checklist.retention).toEqual({ documentYears: 5, provisional: true });
    expect(checklist.drafts).toEqual([]);
  });

  it('lists the current documents still marked draft', async () => {
    const { service } = build({
      registry: [aLegalDocument({ type: 'terms', version: '0.1' }), FINAL[1] as never],
    });

    expect((await service.checklist()).drafts).toEqual([{ type: 'terms', version: '0.1' }]);
  });

  it('is ready with the four validations on final documents', async () => {
    const { service, repo } = build();
    await record(repo, 'third-party-processing');
    await record(repo, 'retention-periods', { retentionYears: 5 });
    await record(repo, 'privacy-policy', { documentVersions: ['privacy:1.0'] });
    await record(repo, 'terms', { documentVersions: ['terms:1.0'] });

    const checklist = await service.checklist();

    expect(checklist.launchReady).toBe(true);
    expect(checklist.retention.provisional).toBe(false);
  });

  it('reads the settings: flags, the private bucket and the gate', async () => {
    const off = await build({
      env: {
        DOCUMENT_RETENTION_ENABLED: 'false',
        ACCOUNT_PURGE_ENABLED: 'false',
        NODE_ENV: 'production',
      },
    }).service.checklist();
    expect(off.settings).toEqual({
      termsEnforcementEnabled: false,
      accountPurgeEnabled: false,
      dataExportEnabled: true,
      documentRetentionEnabled: false,
      privateBucketConfigured: false,
      legalGateEnforced: true,
    });

    const on = await build({
      env: {
        R2_PRIVATE_BUCKET: 'priv',
        TERMS_ENFORCEMENT_ENABLED: 'true',
        DOCUMENT_RETENTION_YEARS: '6',
      },
    }).service.checklist();
    expect(on.settings).toMatchObject({
      termsEnforcementEnabled: true,
      privateBucketConfigured: true,
      legalGateEnforced: false,
    });
    expect(on.retention.documentYears).toBe(6);
  });

  it('is not ready in production with LEGAL_GATE_ENFORCED=false, even with all four validations', async () => {
    const closed = build({ env: { NODE_ENV: 'production' } });
    const open = build({ env: { NODE_ENV: 'production', LEGAL_GATE_ENFORCED: 'false' } });
    for (const { repo } of [closed, open]) {
      await record(repo, 'third-party-processing');
      await record(repo, 'retention-periods', { retentionYears: 5 });
      await record(repo, 'privacy-policy', { documentVersions: ['privacy:1.0'] });
      await record(repo, 'terms', { documentVersions: ['terms:1.0'] });
    }

    expect((await closed.service.checklist()).launchReady).toBe(true);
    const notReady = await open.service.checklist();
    expect(notReady.launchReady).toBe(false);
    expect(notReady.settings.legalGateEnforced).toBe(false);
  });

  it('a retention validation naming 6 does not count when the setting is back to 5', async () => {
    const { service, repo } = build({ env: { DOCUMENT_RETENTION_YEARS: '5' } });
    await record(repo, 'retention-periods', { retentionYears: 6 });

    const checklist = await service.checklist();

    expect(checklist.gates.find((g) => g.scope === 'retention-periods')?.validated).toBe(false);
    expect(checklist.retention).toEqual({ documentYears: 5, provisional: true });
  });

  it('carries no validator name', async () => {
    const { service, repo } = build();
    await record(repo, 'third-party-processing', { reference: 'parecer-9' });

    const text = JSON.stringify(await service.checklist());

    expect(text).not.toContain('Segredo');
    expect(text).not.toContain('parecer-9');
  });
});
