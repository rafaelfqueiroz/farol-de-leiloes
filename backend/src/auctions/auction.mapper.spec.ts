// AR-17 / AR-28 (expand): stored auctions in either money shape read as Decimals; phases are
// written as Decimal128 only.
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Decimal } from '../common/money/money';
import { restorePhase, toAuction, toStoredPhase } from './auction.mapper';
import { PaymentMethod, PhaseModality } from './schemas/auction.schema';

const d128 = (value: string) => Types.Decimal128.fromString(value);
const UPDATED = new Date('2026-01-15T12:00:00.000Z');

describe('toAuction', () => {
  it('reads Decimal128 prices (the new shape) as Decimals', () => {
    const phase = { modality: PhaseModality.ONLINE_SALES, minimumPrice: d128('91589.89') };
    const auction = toAuction({
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

  it('EXPAND: reads legacy number prices as the same Decimals', () => {
    const phase = { modality: PhaseModality.ONLINE_SALES, minimumPrice: 91589.89 };
    const auction = toAuction({
      code: 'A1',
      appraisalPrice: 250000,
      phases: [phase],
      currentPhase: phase,
      updatedAt: UPDATED,
    });

    expect(auction.appraisalPrice).toEqual(new Decimal('250000'));
    expect(auction.currentPhase?.minimumPrice).toEqual(new Decimal('91589.89'));
  });

  it('answers null prices and defaults for a bare record, and the last phase as current', () => {
    const first = { modality: PhaseModality.SFI_AUCTION };
    const last = { modality: PhaseModality.ONLINE_SALES, minimumPrice: null };
    const auction = toAuction({ code: 'A1', phases: [first, last], updatedAt: UPDATED });

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
    expect(toAuction({ code: 'A2', updatedAt: UPDATED }).currentPhase).toBeNull();
  });

  it('prefers the R2 copy of a file and falls back to Caixa', () => {
    const auction = toAuction({
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

describe('toStoredPhase / restorePhase', () => {
  it('AR-17: writes the price as Decimal128 and leaves absent fields absent', () => {
    expect(
      toStoredPhase({ modality: PhaseModality.ONLINE_SALES, minimumPrice: new Decimal('10.5') }),
    ).toEqual({ modality: PhaseModality.ONLINE_SALES, minimumPrice: d128('10.5') });
    expect(toStoredPhase({ modality: PhaseModality.ONLINE_SALES, minimumPrice: null })).toEqual({
      modality: PhaseModality.ONLINE_SALES,
      minimumPrice: null,
    });
  });

  it('EXPAND: rewrites a legacy number price as Decimal128, keeping every other field', () => {
    const dates = [new Date('2026-03-03T13:00:00.000Z')];
    const legacy = {
      modality: PhaseModality.SFI_AUCTION,
      minimumPrice: 120000.5,
      phaseDates: dates,
      paymentMethods: [PaymentMethod.FGTS],
      expenseRules: [{ type: 'Condomínio', description: 'Comprador' }],
    };

    expect(restorePhase(legacy)).toEqual({ ...legacy, minimumPrice: d128('120000.5') });
  });
});
