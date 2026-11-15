import { describe, expect, it } from 'vitest';
import { PhaseModality } from '../../src/auctions/schemas/auction.schema.js';
import { Decimal } from '../../src/common/money/money.js';
import {
  FIXTURE_AUCTIONS,
  STATE_WEIGHTS,
  generatedCode,
  referenceCatalog,
  seededRandom,
} from './catalog.js';
import { E2E_MONGO_HOST, seedTargetProblem } from './target.js';

// 2026-03-02 12:00 UTC = 09:00 in Brasília, a Monday.
const REFERENCE = new Date('2026-03-02T12:00:00Z');
const catalog = (size: number, seed = 3) => [
  ...referenceCatalog({ size, seed, referenceDate: REFERENCE }),
];

describe('BR-003-08: the reference catalog', () => {
  it('is deterministic: the same seed and reference date give the same documents', () => {
    expect(JSON.stringify(catalog(200))).toBe(JSON.stringify(catalog(200)));
    expect(JSON.stringify(catalog(200, 4))).not.toBe(JSON.stringify(catalog(200)));
  });

  it('carries the fixtures first, then exactly `size` generated auctions with unique codes', () => {
    const auctions = catalog(500);
    expect(auctions).toHaveLength(501);
    expect(auctions[0]?.code).toBe(FIXTURE_AUCTIONS.BRASILIA_TEN_AM);
    expect(new Set(auctions.map((auction) => auction.code)).size).toBe(501);
    // Caixa-like 13-digit codes; 9 is reserved for fixtures.
    expect(generatedCode(1)).toBe('2000000000001');
    expect(generatedCode(35_000)).toBe('1000000035000');
    expect(auctions.slice(1).every((auction) => /^[1-8]\d{12}$/.test(auction.code))).toBe(true);
  });

  it('publishes the fixture for 26/01/2026 - 10h00 Brasília, i.e. 13:00 UTC (BR-003-25)', () => {
    const [fixture] = catalog(0);
    expect(fixture?.currentPhase?.phaseDates).toEqual([new Date('2026-01-26T13:00:00.000Z')]);
  });

  it('covers all 27 states, weighted like the Caixa list (RJ and SP far above RR)', () => {
    const auctions = catalog(10_000).slice(1);
    const perState = new Map<string, number>();
    for (const auction of auctions) {
      const state = auction.address?.state ?? '';
      perState.set(state, (perState.get(state) ?? 0) + 1);
    }
    expect([...perState.keys()].sort()).toEqual(Object.keys(STATE_WEIGHTS).sort());
    // RJ is 150‰ of the weight: ~1 500 of 10 000; RR is 4‰: ~40. Wide bounds, same seed.
    expect(perState.get('RJ')).toBeGreaterThan(1_300);
    expect(perState.get('RJ')).toBeLessThan(1_700);
    expect(perState.get('RR')).toBeLessThan(100);
  });

  it('stores prices as Decimal128 with two places, the minimum at 40–89% of the appraisal (AR-17)', () => {
    for (const auction of catalog(300).slice(1)) {
      const appraisal = auction.appraisalPrice?.toString() ?? '';
      const minimum = auction.currentPhase?.minimumPrice?.toString() ?? '';
      expect(appraisal).toMatch(/^\d+(\.\d{1,2})?$/); // MONEY_PATTERN: whole reais here
      expect(minimum).toMatch(/^\d+(\.\d{1,2})?$/);
      // AR-17: compared as Decimals, never floats.
      const ratio = new Decimal(minimum).div(appraisal);
      expect(ratio.gte('0.4')).toBe(true);
      expect(ratio.lt('0.9')).toBe(true);
    }
  });

  it('dates every non-online sale at a whole Brasília hour, mostly after the reference day', () => {
    const dated = catalog(1_000)
      .slice(1)
      .filter((auction) => auction.currentPhase?.modality !== PhaseModality.ONLINE_SALES);
    const firsts = dated.map((auction) => auction.currentPhase?.phaseDates?.[0]);
    expect(firsts.every((date) => date instanceof Date && date.getUTCMinutes() === 0)).toBe(true);
    const future = firsts.filter((date) => date && date > REFERENCE).length;
    expect(future / firsts.length).toBeGreaterThan(0.8);
  });

  it('refuses a negative or fractional size', () => {
    expect(() => catalog(-1)).toThrow('non-negative integer');
    expect(() => catalog(1.5)).toThrow('non-negative integer');
  });

  it('draws the same sequence from the same seed', () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('DV-19: where the seed may write', () => {
  it('accepts the E2E stack MongoDB', () => {
    expect(seedTargetProblem(`mongodb://${E2E_MONGO_HOST}:27017/farol-e2e`)).toBeNull();
  });

  it('refuses the developer database unless its host is named explicitly', () => {
    expect(seedTargetProblem('mongodb://localhost:27017/auctions')).toContain('SEED_ALLOW_HOSTS');
    expect(
      seedTargetProblem('mongodb://localhost:55001/t_seed?directConnection=true', ['localhost']),
    ).toBeNull();
  });

  it('refuses Atlas even when named', () => {
    expect(seedTargetProblem('mongodb+srv://user:pw@cluster0.abcde.mongodb.net/farol')).toContain(
      'Atlas',
    );
    expect(seedTargetProblem('mongodb://a.mongodb.net:27017/farol', ['a.mongodb.net'])).toContain(
      'Atlas',
    );
  });

  it('checks every host of a replica-set URI, and needs a database name', () => {
    expect(seedTargetProblem('mongodb://mongo-e2e:27017,other:27017/farol')).toContain('other');
    expect(seedTargetProblem('mongodb://mongo-e2e:27017/')).toContain('database');
    expect(seedTargetProblem('http://mongo-e2e/farol')).toContain('mongodb://');
  });
});
