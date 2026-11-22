// SPEC-010 BR-010-26: the arguments and the rules of `npm run legal:record-validation` (TS-01). The
// script never echoes the validator's name, the reference or a rejected value (SC-15).
import { describe, expect, it } from 'vitest';
import {
  exitCodeOf,
  parseRecordValidationArgs,
  planValidation,
  type RecordValidationInput,
  summaryOf,
} from './record-validation.js';

const REGISTRY = [
  { type: 'terms', version: '0.1', draft: true },
  { type: 'privacy', version: '0.1', draft: true },
  { type: 'terms', version: '1.0', draft: false },
  { type: 'privacy', version: '1.0', draft: false },
];

const input = (overrides: Partial<RecordValidationInput>): RecordValidationInput => ({
  scope: 'third-party-processing',
  validator: 'Dra. Fulana de Tal',
  versions: [],
  ...overrides,
});

describe('parseRecordValidationArgs', () => {
  it('reads every option, as separate words or with =', () => {
    expect(
      parseRecordValidationArgs([
        '--scope',
        'retention-periods',
        '--validator',
        'Silva & Souza Advogados',
        '--versions=terms:1.0,privacy:1.0',
        '--reference',
        'parecer 12/2026',
        '--retention-years=5',
      ]),
    ).toEqual({
      ok: true,
      input: {
        scope: 'retention-periods',
        validator: 'Silva & Souza Advogados',
        versions: ['terms:1.0', 'privacy:1.0'],
        reference: 'parecer 12/2026',
        retentionYears: 5,
      },
    });
  });

  it('needs only a scope and a validator, and trims the validator', () => {
    expect(
      parseRecordValidationArgs([
        '--scope',
        'third-party-processing',
        '--validator',
        '  Ana Lima ',
      ]),
    ).toEqual({
      ok: true,
      input: { scope: 'third-party-processing', validator: 'Ana Lima', versions: [] },
    });
  });

  it('keeps an = inside the validator name and drops a repeated version', () => {
    const parsed = parseRecordValidationArgs([
      '--scope=terms',
      '--validator=A=B Advogados',
      '--versions',
      'terms:1.0, terms:1.0',
    ]);
    expect(parsed).toMatchObject({
      ok: true,
      input: { validator: 'A=B Advogados', versions: ['terms:1.0'] },
    });
  });

  it.each([
    ['no scope', ['--validator', 'Ana Lima'], 'scope'],
    ['an unknown scope', ['--scope', 'everything', '--validator', 'Ana Lima'], 'scope'],
    ['no validator', ['--scope', 'terms'], 'validator'],
    ['a one-letter validator', ['--scope', 'terms', '--validator', 'A'], 'validator'],
    ['a too long validator', ['--scope', 'terms', '--validator', 'x'.repeat(121)], 'validator'],
    [
      'zero years',
      ['--scope', 'retention-periods', '--validator', 'Ana Lima', '--retention-years', '0'],
      'retentionYears',
    ],
    [
      'fractional years',
      ['--scope', 'retention-periods', '--validator', 'Ana Lima', '--retention-years', '5.5'],
      'retentionYears',
    ],
    [
      'an empty versions list entry',
      ['--scope', 'terms', '--validator', 'Ana Lima', '--versions', 'terms:1.0,,privacy:1.0'],
      'versions',
    ],
    [
      'eleven versions',
      [
        '--scope',
        'terms',
        '--validator',
        'Ana Lima',
        '--versions',
        Array.from({ length: 11 }, (_, i) => `terms:${i}.0`).join(','),
      ],
      'versions',
    ],
  ])('refuses %s, naming the field', (_label, argv, field) => {
    const parsed = parseRecordValidationArgs(argv);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(field);
  });

  it('refuses an unknown argument, a repeated one and a missing value, without echoing them', () => {
    for (const argv of [
      ['--scope', 'terms', '--validator', 'Ana Lima', '--allow-draft'],
      ['--scope', 'terms', '--scope', 'terms', '--validator', 'Ana Lima'],
      ['Ana Lima'],
    ]) {
      const parsed = parseRecordValidationArgs(argv);
      expect(parsed).toMatchObject({ ok: false });
      if (!parsed.ok) {
        expect(parsed.error).toContain('usage:');
        expect(parsed.error).not.toContain('Ana Lima');
        expect(parsed.error).not.toContain('allow-draft');
      }
    }
    const missing = parseRecordValidationArgs(['--scope']);
    expect(missing).toMatchObject({ ok: false });
    if (!missing.ok) expect(missing.error).toContain('--scope needs a value');
  });

  it('never echoes the validator or the reference in a validation error', () => {
    const parsed = parseRecordValidationArgs([
      '--scope',
      'nope',
      '--validator',
      'Dra. Segredo',
      '--reference',
      'x'.repeat(200),
    ]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).not.toContain('Segredo');
      expect(parsed.error).not.toContain('xxxx');
    }
  });
});

describe('planValidation', () => {
  it('plans a third-party validation with no version', () => {
    expect(planValidation(input({}), REGISTRY)).toEqual({
      ok: true,
      scope: 'third-party-processing',
      validatorName: 'Dra. Fulana de Tal',
      documentVersions: [],
    });
  });

  it('plans terms and privacy-policy validations on final versions', () => {
    expect(
      planValidation(input({ scope: 'terms', versions: ['terms:1.0', 'privacy:1.0'] }), REGISTRY),
    ).toMatchObject({ ok: true, documentVersions: ['terms:1.0', 'privacy:1.0'] });
    expect(
      planValidation(
        input({ scope: 'privacy-policy', versions: ['privacy:1.0'], reference: 'p-7' }),
        REGISTRY,
      ),
    ).toMatchObject({ ok: true, reference: 'p-7' });
  });

  it('plans a retention validation with the period reviewed', () => {
    expect(
      planValidation(input({ scope: 'retention-periods', retentionYears: 5 }), REGISTRY),
    ).toMatchObject({ ok: true, retentionYears: 5 });
  });

  it('refuses a draft placeholder: it cannot be validated', () => {
    const plan = planValidation(input({ scope: 'terms', versions: ['terms:0.1'] }), REGISTRY);
    expect(plan).toEqual({
      ok: false,
      reason: expect.stringContaining('terms:0.1 is a draft placeholder'),
    });
  });

  it('refuses a draft among final versions, in any scope', () => {
    const plan = planValidation(
      input({ scope: 'third-party-processing', versions: ['terms:1.0', 'privacy:0.1'] }),
      REGISTRY,
    );
    expect(plan).toMatchObject({ ok: false, reason: expect.stringContaining('privacy:0.1') });
  });

  it('refuses a version that is not in the legal registry', () => {
    expect(planValidation(input({ scope: 'terms', versions: ['terms:9.9'] }), REGISTRY)).toEqual({
      ok: false,
      reason: 'terms:9.9 is not a version in the legal registry',
    });
  });

  it('refuses an entry that is not <type>:<version>, without echoing it', () => {
    const plan = planValidation(input({ scope: 'terms', versions: ['cookies:1.0'] }), REGISTRY);
    expect(plan).toEqual({ ok: false, reason: 'a --versions entry is not <type>:<version>' });
  });

  it('terms needs a terms version and privacy-policy a privacy version', () => {
    expect(planValidation(input({ scope: 'terms' }), REGISTRY)).toMatchObject({
      ok: false,
      reason: 'scope terms needs a --versions entry terms:<version>',
    });
    expect(
      planValidation(input({ scope: 'terms', versions: ['privacy:1.0'] }), REGISTRY),
    ).toMatchObject({
      ok: false,
    });
    expect(
      planValidation(input({ scope: 'privacy-policy', versions: ['terms:1.0'] }), REGISTRY),
    ).toMatchObject({
      ok: false,
      reason: 'scope privacy-policy needs a --versions entry privacy:<version>',
    });
  });

  it('retention-periods needs the period; no other scope takes one', () => {
    expect(planValidation(input({ scope: 'retention-periods' }), REGISTRY)).toEqual({
      ok: false,
      reason: 'scope retention-periods needs --retention-years',
    });
    expect(planValidation(input({ retentionYears: 5 }), REGISTRY)).toEqual({
      ok: false,
      reason: '--retention-years belongs to scope retention-periods',
    });
  });
});

describe('the outcome', () => {
  it('exits 0 and prints the scope and versions, never the validator or the reference', () => {
    const outcome = {
      result: 'recorded',
      scope: 'terms',
      documentVersions: ['terms:1.0', 'privacy:1.0'],
    } as const;
    expect(exitCodeOf(outcome)).toBe(0);
    expect(summaryOf(outcome)).toBe(
      'legal:record-validation: recorded terms for terms:1.0, privacy:1.0',
    );
    expect(
      summaryOf({ result: 'recorded', scope: 'third-party-processing', documentVersions: [] }),
    ).toBe('legal:record-validation: recorded third-party-processing');
  });

  it('exits 1 for a refusal and says nothing was written', () => {
    const outcome = { result: 'refused', reason: 'terms:0.1 is a draft placeholder' } as const;
    expect(exitCodeOf(outcome)).toBe(1);
    expect(summaryOf(outcome)).toBe(
      'legal:record-validation: refused, terms:0.1 is a draft placeholder; nothing was written',
    );
  });
});
