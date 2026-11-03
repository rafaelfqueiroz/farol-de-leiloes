// #34 / AR-17: the conversions of the money migration, with hand-computed expectations (TS-04).
// The run against MongoDB — selection, compare-and-set, idempotence — is
// test/integration/migrations.spec.ts.
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  auctionChanges,
  conditionalUpdate,
  couponChanges,
  LEGACY_NUMBER_TYPES,
  reaisFromLegacyCentavos,
  reaisFromLegacyNumber,
  savedFilterChanges,
} from './0001-money-decimal128.migration';

const d128 = (value: string) => Types.Decimal128.fromString(value);

describe('reaisFromLegacyNumber', () => {
  it.each([
    // 91589.89 has no exact binary form (the double is 91589.8899999999994…); its shortest
    // round-trip text is the decimal the importer parsed, and that is what is stored.
    [91589.89, '91589.89'],
    [74628.94, '74628.94'],
    [130000, '130000'],
    [0.1, '0.1'],
    [0, '0'],
    [250000.5, '250000.5'],
  ])('%s → Decimal128 %s', (value, expected) => {
    expect(reaisFromLegacyNumber(value).toString()).toBe(expected);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'refuses %s, which no writer stored',
    (value) => {
      expect(() => reaisFromLegacyNumber(value)).toThrow('not a finite number');
    },
  );
});

describe('reaisFromLegacyCentavos', () => {
  it.each([
    [1050, '10.50'], // 1050 / 100 = 10.50
    [1000, '10.00'], // 1000 / 100 = 10.00
    [1, '0.01'],
    [0, '0.00'],
    [123456789, '1234567.89'],
  ])('%s centavos → Decimal128 %s reais', (centavos, expected) => {
    expect(reaisFromLegacyCentavos(centavos).toString()).toBe(expected);
  });

  it.each([10.5, Number.NaN, 2 ** 53])('refuses %s, which is not integer centavos', (value) => {
    expect(() => reaisFromLegacyCentavos(value)).toThrow('not an integer number of centavos');
  });
});

describe('auctionChanges', () => {
  it('converts every number price and only those: index paths for the phases', () => {
    const doc = {
      _id: 'a1',
      appraisalPrice: 130000,
      phases: [
        { modality: 'SFI_AUCTION', minimumPrice: 91589.89 },
        { modality: 'OPEN_BIDDING', minimumPrice: d128('80000') },
        { modality: 'ONLINE_SALES', minimumPrice: null },
        { modality: 'ONLINE_SALES' },
        { modality: 'ONLINE_SALES', minimumPrice: 74628.94 },
      ],
      currentPhase: { modality: 'ONLINE_SALES', minimumPrice: 74628.94 },
    };

    expect(auctionChanges(doc)).toEqual([
      { path: 'appraisalPrice', from: 130000, to: d128('130000') },
      { path: 'phases.0.minimumPrice', from: 91589.89, to: d128('91589.89') },
      { path: 'phases.4.minimumPrice', from: 74628.94, to: d128('74628.94') },
      { path: 'currentPhase.minimumPrice', from: 74628.94, to: d128('74628.94') },
    ]);
  });

  it('has nothing to change in a converted, null or bare auction', () => {
    expect(
      auctionChanges({
        appraisalPrice: d128('1'),
        phases: [{ minimumPrice: d128('2') }],
        currentPhase: { minimumPrice: d128('2') },
      }),
    ).toEqual([]);
    expect(auctionChanges({ appraisalPrice: null, phases: null, currentPhase: null })).toEqual([]);
    expect(auctionChanges({ phases: [null, 'odd'] })).toEqual([]);
    expect(auctionChanges({})).toEqual([]);
  });
});

describe('couponChanges', () => {
  it('converts a centavos discount and leaves a Decimal128 one alone', () => {
    expect(couponChanges({ discountValue: 1050 })).toEqual([
      { path: 'discountValue', from: 1050, to: d128('10.50') },
    ]);
    expect(couponChanges({ discountValue: d128('10.50') })).toEqual([]);
  });
});

describe('savedFilterChanges', () => {
  it('converts number bounds and leaves converted, null or absent ones alone', () => {
    expect(savedFilterChanges({ filters: { minMargin: 100000, maxMargin: 250000.5 } })).toEqual([
      { path: 'filters.minMargin', from: 100000, to: d128('100000') },
      { path: 'filters.maxMargin', from: 250000.5, to: d128('250000.5') },
    ]);
    expect(savedFilterChanges({ filters: { minMargin: d128('1'), maxMargin: null } })).toEqual([]);
    expect(savedFilterChanges({ filters: { city: ['Natal'] } })).toEqual([]);
    expect(savedFilterChanges({})).toEqual([]);
  });
});

describe('conditionalUpdate', () => {
  it('sets each path only while it still holds the number read, as a BSON number', () => {
    const update = conditionalUpdate('a1', [
      { path: 'appraisalPrice', from: 130000, to: d128('130000') },
      { path: 'phases.0.minimumPrice', from: 91589.89, to: d128('91589.89') },
    ]);

    expect(update).toEqual({
      updateOne: {
        filter: {
          _id: 'a1',
          appraisalPrice: { $eq: 130000, $type: ['double', 'int', 'long'] },
          'phases.0.minimumPrice': { $eq: 91589.89, $type: ['double', 'int', 'long'] },
        },
        update: {
          $set: { appraisalPrice: d128('130000'), 'phases.0.minimumPrice': d128('91589.89') },
        },
      },
    });
  });

  it("never selects by the 'number' alias, which matches Decimal128 too", () => {
    expect(LEGACY_NUMBER_TYPES).not.toContain('number');
    expect(LEGACY_NUMBER_TYPES).not.toContain('decimal');
  });
});
