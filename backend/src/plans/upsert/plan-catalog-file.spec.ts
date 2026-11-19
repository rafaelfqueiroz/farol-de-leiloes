// SPEC-012 BR-012-01, BR-012-02: the catalog file is validated in full before anything is written.
import { describe, expect, it } from 'vitest';
import { Decimal } from '../../common/money/money.js';
import { parsePlanCatalog, parsePlansUpsertArgs, PLANS_UPSERT_USAGE } from './plan-catalog-file.js';

const ENTRY = {
  code: 'escritorio-5',
  name: 'Escritório 5',
  price: '199.90',
  interval: 'month',
  activeJourneyLimit: 5,
  stripePriceId: 'price_1AbC',
};

describe('parsePlanCatalog', () => {
  it('BR-012-01: reads a plan with its money as a Decimal and the defaults of status and order', () => {
    const parsed = parsePlanCatalog({ plans: [ENTRY] });

    expect(parsed).toEqual({
      ok: true,
      plans: [{ ...ENTRY, price: new Decimal('199.90'), status: 'OFFERED', sortOrder: 0 }],
    });
    if (parsed.ok) expect(parsed.plans[0]?.price).toBeInstanceOf(Decimal);
  });

  it('keeps an explicit status and sort order', () => {
    const parsed = parsePlanCatalog({
      plans: [{ ...ENTRY, status: 'WITHDRAWN', sortOrder: 30, interval: 'year' }],
    });

    expect(parsed.ok && parsed.plans[0]).toMatchObject({
      status: 'WITHDRAWN',
      sortOrder: 30,
      interval: 'year',
    });
  });

  it.each([
    ['a price as a JSON number (AR-17: money is never a float)', { price: 199.9 }, 'price'],
    ['a price with three decimals', { price: '199.999' }, 'price'],
    ['a free price (zero)', { price: '0.00' }, 'price'],
    ['a negative price', { price: '-5' }, 'price'],
    [
      'a limit of zero (BR-012-01: a positive integer)',
      { activeJourneyLimit: 0 },
      'activeJourneyLimit',
    ],
    ['a fractional limit', { activeJourneyLimit: 2.5 }, 'activeJourneyLimit'],
    ['a limit as text', { activeJourneyLimit: '5' }, 'activeJourneyLimit'],
    ['an unknown interval', { interval: 'week' }, 'interval'],
    ['an unknown status', { status: 'HIDDEN' }, 'status'],
    ['a code with spaces', { code: 'escritorio 5' }, 'code'],
    ['an empty name', { name: '  ' }, 'name'],
    ['a price id that is not a provider price', { stripePriceId: 'prod_123' }, 'stripePriceId'],
    ['a field the catalog does not have', { audience: 'ADVISOR_OFFICE' }, 'file'],
  ])('refuses %s', (_label, override, field) => {
    const parsed = parsePlanCatalog({ plans: [{ ...ENTRY, ...override }] });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.error).toContain(field === 'file' ? 'plans.0' : `plans.0.${field}`);
  });

  it('refuses a file with no plan, a plan list that is not a list, and extra top-level keys', () => {
    expect(parsePlanCatalog({ plans: [] }).ok).toBe(false);
    expect(parsePlanCatalog({ plans: 'x' }).ok).toBe(false);
    expect(parsePlanCatalog({ plans: [ENTRY], extra: 1 }).ok).toBe(false);
    expect(parsePlanCatalog(null).ok).toBe(false);
  });

  it('refuses a repeated code and a repeated provider price within the file', () => {
    const duplicateCode = parsePlanCatalog({
      plans: [ENTRY, { ...ENTRY, stripePriceId: 'price_other' }],
    });
    const duplicatePrice = parsePlanCatalog({ plans: [ENTRY, { ...ENTRY, code: 'other' }] });

    expect(duplicateCode).toEqual({
      ok: false,
      error: expect.stringContaining('plans.1.code: duplicate code in the file'),
    });
    expect(duplicatePrice).toEqual({
      ok: false,
      error: expect.stringContaining('plans.1.stripePriceId: duplicate stripePriceId in the file'),
    });
  });

  it('SC-15: the error names fields and never echoes the value it refused', () => {
    const parsed = parsePlanCatalog({
      plans: [{ ...ENTRY, name: '', stripePriceId: 'SECRET-123' }],
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).not.toContain('SECRET-123');
  });
});

describe('parsePlansUpsertArgs', () => {
  it.each([
    [['--file', 'plans.json'], 'plans.json'],
    [['--file=plans.json'], 'plans.json'],
  ])('reads %j', (argv, file) => {
    expect(parsePlansUpsertArgs(argv)).toEqual({ ok: true, file });
  });

  it('asks for the file when there is none', () => {
    expect(parsePlansUpsertArgs([])).toEqual({
      ok: false,
      error: `a --file is required; ${PLANS_UPSERT_USAGE}`,
    });
    expect(parsePlansUpsertArgs(['--file'])).toMatchObject({ ok: false });
  });

  it('refuses an unknown argument without echoing it', () => {
    const parsed = parsePlansUpsertArgs(['--file', 'a.json', '--secret=abc']);

    expect(parsed).toEqual({ ok: false, error: `unknown argument; ${PLANS_UPSERT_USAGE}` });
  });
});
