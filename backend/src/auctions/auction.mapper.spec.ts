// AR-17: stored auctions hold Decimal128 prices, read as Decimals; phases are written as
// Decimal128 only.
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Decimal } from '../common/money/money.js';
import { fromStoredPhase, toAuction, toStoredPhase } from './auction.mapper.js';
import { PaymentMethod, PhaseModality } from './schemas/auction.schema.js';

const d128 = (value: string) => Types.Decimal128.fromString(value);
const UPDATED = new Date('2026-01-15T12:00:00.000Z');
// Reads are made at an instant the spec chooses (AR-24); by default the one of the record.
const read = (doc: Parameters<typeof toAuction>[0], now: Date = UPDATED) => toAuction(doc, now);

describe('toAuction', () => {
  it('reads Decimal128 prices (the new shape) as Decimals', () => {
    const phase = { modality: PhaseModality.ONLINE_SALES, minimumPrice: d128('91589.89') };
    const auction = read({
      code: 'A1',
      appraisalPrice: d128('250000'),
      phases: [phase],
      currentPhase: phase,
      updatedAt: UPDATED,
    });

    expect(auction.appraisalPrice?.toFixed()).toBe('250000');
    expect(auction.phases[0]?.minimumPrice?.toFixed()).toBe('91589.89');
    expect(auction.currentPhase?.minimumPrice?.toFixed()).toBe('91589.89');
  });

  // AR-28 contract: the #34 migration left no number price behind, so one is a fault.
  it('refuses a number price, which only a skipped migration would leave (DV-34)', () => {
    const legacy = { modality: PhaseModality.ONLINE_SALES, minimumPrice: 91589.89 };
    const record = (overrides: object) =>
      read({ code: 'A1', updatedAt: UPDATED, ...overrides } as Parameters<typeof toAuction>[0]);

    expect(() => record({ appraisalPrice: 250000 })).toThrow('Stored money is not Decimal128');
    expect(() => record({ phases: [legacy] })).toThrow(TypeError);
    expect(() => record({ currentPhase: legacy })).toThrow(TypeError);
  });

  it('answers null prices and defaults for a bare record, and the last phase as current', () => {
    const first = { modality: PhaseModality.SFI_AUCTION };
    const last = { modality: PhaseModality.ONLINE_SALES, minimumPrice: null };
    const auction = read({ code: 'A1', phases: [first, last], updatedAt: UPDATED });

    expect(auction).toMatchObject({
      appraisalPrice: null,
      title: null,
      address: null,
      fulfilled: false,
      available: true,
      editalUrl: null,
    });
    expect(auction.phases.map((phase) => phase.minimumPrice)).toEqual([null, null]);
    expect(auction.currentPhase?.modality).toBe(PhaseModality.ONLINE_SALES);
    expect(read({ code: 'A2', updatedAt: UPDATED }).currentPhase).toBeNull();
  });

  it('prefers the R2 copy of a file and falls back to Caixa', () => {
    const auction = read({
      code: 'A1',
      image: { originalUrl: 'https://caixa.example.test/f.jpg', mimeType: 'image/jpeg' },
      matricula: {
        originalUrl: 'https://caixa.example.test/m.pdf',
        publicUrl: 'https://files.example.test/m.pdf',
        mimeType: 'application/pdf',
      },
      updatedAt: UPDATED,
    });

    expect(auction.imageUrl).toBe('https://caixa.example.test/f.jpg');
    expect(auction.matriculaUrl).toBe('https://files.example.test/m.pdf');
  });
});

// SPEC-004 BR-004-13, BR-004-14, BR-004-16, BR-004-17: what a read computes against "now".
describe('toAuction read-time state', () => {
  const MARCH_10_10H = new Date('2026-03-10T13:00:00.000Z'); // 10h00 in Brasília
  const rounds = [
    { label: '1º Leilão', minimumPrice: d128('150000'), date: MARCH_10_10H },
    {
      label: '2º Leilão',
      minimumPrice: d128('120000'),
      date: new Date('2026-03-16T13:00:00.000Z'),
    },
  ];
  const phase = { modality: PhaseModality.SFI_AUCTION, minimumPrice: d128('150000') };
  const stored = {
    code: 'A1',
    appraisalPrice: d128('200000'),
    phases: [phase],
    currentPhase: phase,
    rounds,
    updatedAt: UPDATED,
  };
  const at = (iso: string) => read(stored, new Date(iso));

  it('shows the 1st round price and discount until 09h59, the 2nd from 10h00, with no import', () => {
    expect(at('2026-03-10T12:59:59.999Z')).toMatchObject({ active: true });
    expect(at('2026-03-10T12:59:59.999Z').currentMinimumPrice?.toFixed()).toBe('150000');
    expect(at('2026-03-10T12:59:59.999Z').discountPercent?.toFixed()).toBe('25');
    expect(at('2026-03-10T13:00:00.000Z').currentMinimumPrice?.toFixed()).toBe('120000');
    expect(at('2026-03-10T13:00:00.000Z').discountPercent?.toFixed()).toBe('40');
  });

  it('is inactive once every round has passed, and keeps its last known data (BR-004-17)', () => {
    const closed = at('2026-03-16T13:00:00.000Z');

    expect(closed.active).toBe(false);
    expect(closed.available).toBe(true);
    // No round is left: the list price stands as the last known one.
    expect(closed.currentMinimumPrice?.toFixed()).toBe('150000');
    expect(closed.code).toBe('A1');
  });

  it('is inactive when the last list did not have it, whatever its dates', () => {
    const gone = read({ ...stored, available: false }, new Date('2026-03-01T00:00:00Z'));

    expect(gone).toMatchObject({ available: false, active: false });
  });

  it('keeps a negative discount, never clamped (BR-004-14)', () => {
    const dear = read({ ...stored, rounds: undefined, appraisalPrice: d128('100000') });

    expect(dear.discountPercent?.toFixed()).toBe('-50');
  });

  it('knows nothing it was not told: no rounds is active with the list price; no price is null', () => {
    const fresh = read({ code: 'A1', updatedAt: UPDATED });

    expect(fresh).toMatchObject({
      active: true,
      currentMinimumPrice: null,
      discountPercent: null,
      rounds: [],
      occupancy: null,
    });
  });
});

describe('toStoredPhase', () => {
  it('AR-17: writes the price as Decimal128 and leaves absent fields absent', () => {
    expect(
      toStoredPhase({ modality: PhaseModality.ONLINE_SALES, minimumPrice: new Decimal('10.5') }),
    ).toEqual({ modality: PhaseModality.ONLINE_SALES, minimumPrice: d128('10.5') });
    expect(toStoredPhase({ modality: PhaseModality.ONLINE_SALES, minimumPrice: null })).toEqual({
      modality: PhaseModality.ONLINE_SALES,
      minimumPrice: null,
    });
  });

  it('round-trips a phase with every field through fromStoredPhase', () => {
    const phase = {
      modality: PhaseModality.SFI_AUCTION,
      minimumPrice: new Decimal('120000.5'),
      phaseDates: [new Date('2026-03-03T13:00:00.000Z')],
      paymentMethods: [PaymentMethod.FGTS],
      expenseRules: [{ type: 'Condomínio', description: 'Comprador' }],
    };

    const stored = toStoredPhase(phase);
    expect(stored).toEqual({ ...phase, minimumPrice: d128('120000.5') });
    expect(fromStoredPhase(stored)).toEqual(phase);
  });
});
