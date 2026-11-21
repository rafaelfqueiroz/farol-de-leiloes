// SPEC-010 BR-010-24..26: the service that tells whether a scope is validated, over the fake
// repository, the real LegalDocumentsService and the FakeClock (TS-03, TS-06). The pure rules are
// domain/legal-validation.spec.ts; the guard is legal-validation.guard.spec.ts.
import { describe, expect, it } from 'vitest';
import { aLegalDocument, aLegalRegistry } from '../../../test/builders/legal-document.builder.js';
import { FakeClock } from '../../../test/fakes/fake-clock.js';
import { FakeLegalValidationsRepository } from '../../../test/fakes/fake-privacy-repositories.js';
import { testBusinessConfig } from '../../../test/support/test-env.js';
import { LegalDocumentsService } from '../legal-documents.service.js';
import { LegalValidationService } from './legal-validation.service.js';

const T0 = new Date('2026-06-01T12:00:00.000Z');
const NEW_VERSION_AT = new Date('2026-09-01T03:00:00.000Z');

function build(env: Record<string, string> = {}) {
  const clock = new FakeClock(T0);
  const repo = new FakeLegalValidationsRepository();
  const registry = [
    ...aLegalRegistry('1.0', new Date('2026-01-01T03:00:00.000Z')),
    aLegalDocument({ type: 'terms', version: '1.1', effectiveAt: NEW_VERSION_AT, draft: false }),
  ];
  const documents = new LegalDocumentsService(registry, clock);
  const service = new LegalValidationService(repo as never, documents, testBusinessConfig(env));
  const record = (
    scope: Parameters<FakeLegalValidationsRepository['insert']>[0]['scope'],
    extra = {},
  ) =>
    repo.insert({
      scope,
      validatedAt: clock.now(),
      validatorName: 'Dra. Teste',
      documentVersions: [],
      ...extra,
    });
  return { service, repo, clock, record };
}

describe('LegalValidationService.isValidated', () => {
  it('is false for every scope without a record', async () => {
    const { service } = build();
    for (const scope of [
      'third-party-processing',
      'retention-periods',
      'privacy-policy',
      'terms',
    ] as const) {
      expect(await service.isValidated(scope)).toBe(false);
    }
  });

  it('third-party-processing counts once any record exists', async () => {
    const { service, record } = build();
    await record('third-party-processing');
    expect(await service.isValidated('third-party-processing')).toBe(true);
  });

  it('terms counts only for the version in force, and a new version reopens it as the Clock moves', async () => {
    const { service, record, clock } = build();
    await record('terms', { documentVersions: ['terms:1.0'] });
    expect(await service.isValidated('terms')).toBe(true);

    clock.set(new Date(NEW_VERSION_AT.getTime() - 1));
    expect(await service.isValidated('terms')).toBe(true);
    clock.set(NEW_VERSION_AT); // terms 1.1 takes effect
    expect(await service.isValidated('terms')).toBe(false);

    await record('terms', { documentVersions: ['terms:1.1'] });
    expect(await service.isValidated('terms')).toBe(true);
  });

  it('privacy-policy is not reopened by a new TERMS version', async () => {
    const { service, record, clock } = build();
    await record('privacy-policy', { documentVersions: ['privacy:1.0'] });
    clock.set(NEW_VERSION_AT);
    expect(await service.isValidated('privacy-policy')).toBe(true);
  });

  it('retention-periods follows the setting: reopened when it changes after the review', async () => {
    const five = build({ DOCUMENT_RETENTION_YEARS: '5' });
    await five.record('retention-periods', { retentionYears: 5 });
    expect(await five.service.isValidated('retention-periods')).toBe(true);

    const six = build({ DOCUMENT_RETENTION_YEARS: '6' });
    await six.record('retention-periods', { retentionYears: 5 });
    expect(await six.service.isValidated('retention-periods')).toBe(false);
  });

  it('propagates a repository failure (the guard decides to fail closed)', async () => {
    const { service, repo } = build();
    repo.failReadsWith = new Error('database unavailable');
    await expect(service.isValidated('terms')).rejects.toThrow('database unavailable');
  });
});

describe('LegalValidationService.status', () => {
  it('shows when and which versions, never who validated', async () => {
    const { service, record } = build();
    await record('terms', { documentVersions: ['terms:1.0'], reference: 'parecer-7' });

    const status = await service.status('terms');

    expect(status).toEqual({
      scope: 'terms',
      validated: true,
      validatedAt: T0,
      documentVersions: ['terms:1.0'],
    });
    expect(JSON.stringify(status)).not.toContain('Dra. Teste');
    expect(JSON.stringify(status)).not.toContain('parecer-7');
  });

  it('has no date or versions when the scope is not validated', async () => {
    const { service } = build();
    expect(await service.status('terms')).toEqual({
      scope: 'terms',
      validated: false,
      validatedAt: null,
      documentVersions: null,
    });
  });

  it('statusOfAll answers the four scopes in catalogue order', async () => {
    const { service, record } = build();
    await record('third-party-processing');
    const all = await service.statusOfAll();
    expect(all.map((status) => [status.scope, status.validated])).toEqual([
      ['third-party-processing', true],
      ['retention-periods', false],
      ['privacy-policy', false],
      ['terms', false],
    ]);
  });
});
