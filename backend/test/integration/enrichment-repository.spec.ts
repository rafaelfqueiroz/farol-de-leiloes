// SPEC-004 BR-004-13, BR-004-19, BR-004-21, BR-004-30 (part 4): the queries and writes of
// `EnrichmentRepository` against a real MongoDB (Testcontainers), under the production query
// setting (SC-10). The filters that keep a tier from drowning the budget are proven by STARVATION:
// ineligible properties that sort first must never crowd out the eligible one.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { brasiliaInstant } from '../../src/auctions/domain/import-schedule.js';
import { Decimal } from '../../src/common/money/money.js';
import type { CollectionWrite } from '../../src/auctions/enrichment/enrichment.repository.js';
import { createImportHarness, type ImportHarness } from '../support/import-harness.js';
import { useTestDatabase } from '../support/test-database.js';
import { HH } from '../support/detail-run.js';

const TODAY = '2026-11-24';
const NOW = brasiliaInstant(TODAY, HH(10));
const RUN = '0123456789abcdef01234567';
const OTHER_RUN = 'fedcba987654321001234567';
const FUTURE_ROUND = [
  { label: 'Licitação', date: new Date('2026-12-30T13:00:00Z'), minimumPrice: null },
];
const PAST_ROUND = [
  { label: 'Licitação', date: new Date('2026-10-01T13:00:00Z'), minimumPrice: null },
];

describe('EnrichmentRepository (integration)', () => {
  const db = useTestDatabase();
  let h: ImportHarness;

  beforeAll(async () => {
    h = await createImportHarness(db.uri, NOW);
  });
  afterAll(async () => {
    await h.moduleRef.close();
  });
  beforeEach(async () => {
    await h.kit.auctionModel.deleteMany({});
    h.clock.set(NOW);
  });

  async function insert(code: string, fields: Record<string, unknown> = {}) {
    await h.kit.auctionModel.collection.insertOne({
      code,
      available: true,
      fulfilled: true,
      detailsUrl: `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=${code}`,
      detailsCollectedAt: brasiliaInstant('2026-11-10', HH(9)),
      rounds: FUTURE_ROUND,
      phases: [{ modality: 'OPEN_BIDDING' }],
      currentPhase: { modality: 'OPEN_BIDDING' },
      createdAt: NOW,
      updatedAt: NOW,
      ...fields,
    });
  }

  const find = (limit: number, runId = RUN) =>
    h.properties.findCandidates({ runId, now: NOW, limit, maxStalenessDays: 7 });
  const codesOf = async (limit: number, runId = RUN) =>
    (await find(limit, runId)).map((c) => c.code);

  describe('findCandidates: no tier is starved by what it must not return', () => {
    it('finds the new property although properties in back-off sort before it', async () => {
      for (const code of ['A1', 'A2', 'A3']) {
        await insert(code, {
          detailsCollectedAt: null,
          fulfilled: false,
          detailsFailures: 1,
          detailsRetryAfter: new Date(NOW.getTime() + 3600_000), // still waiting
        });
      }
      await insert('B1', { detailsCollectedAt: null, fulfilled: false });
      await insert('B2', {
        detailsCollectedAt: null,
        fulfilled: false,
        detailsFailures: 1,
        detailsRetryAfter: new Date(NOW.getTime() - 1), // the wait is over
      });

      expect(await codesOf(2)).toEqual(['B1', 'B2']);
    });

    it('finds the property changed in this run although ones changed today or in another run sort before it', async () => {
      const midnight = brasiliaInstant(TODAY, 0);
      for (const code of ['A1', 'A2', 'A3']) {
        // changed in this run but already collected today: nothing left to ask
        await insert(code, {
          lastChangedRunId: new Types.ObjectId(RUN),
          detailsCollectedAt: new Date(midnight.getTime() + 60_000),
        });
      }
      await insert('A4', {
        lastChangedRunId: new Types.ObjectId(OTHER_RUN),
        detailsCollectedAt: brasiliaInstant('2026-11-23', HH(9)),
      });
      await insert('B1', {
        lastChangedRunId: new Types.ObjectId(RUN),
        detailsCollectedAt: brasiliaInstant('2026-11-23', HH(9)),
      });

      expect(await codesOf(2)).toEqual(['B1']);
    });

    it('finds the active stale property although inactive, fresh and waiting ones sort before it', async () => {
      const old = brasiliaInstant('2026-10-01', HH(9));
      for (const code of ['A1', 'A2'])
        await insert(code, { detailsCollectedAt: old, rounds: PAST_ROUND }); // inactive
      await insert('A3', { detailsCollectedAt: brasiliaInstant('2026-11-22', HH(9)) }); // fresh
      await insert('A4', {
        detailsCollectedAt: old,
        detailsFailures: 2,
        detailsRetryAfter: new Date(NOW.getTime() + 86_400_000),
      }); // waiting
      await insert('A5', { detailsCollectedAt: old, available: false }); // unavailable
      await insert('B1', { detailsCollectedAt: brasiliaInstant('2026-11-12', HH(9)) });
      await insert('B2', { detailsCollectedAt: brasiliaInstant('2026-11-05', HH(9)) });

      // The two refreshes, oldest data first.
      expect(await codesOf(2)).toEqual(['B2', 'B1']);
    });

    it('finds a recent property whose last collection failed, once its back-off is over, in the refresh tier', async () => {
      await insert('A1', {
        detailsCollectedAt: brasiliaInstant('2026-11-23', HH(9)),
        detailsFailures: 1,
      });
      await insert('A2', { detailsCollectedAt: brasiliaInstant('2026-11-23', HH(9)) });

      expect(await codesOf(5)).toEqual(['A1']);
    });

    it('never returns an unavailable property or one with no page link in any tier', async () => {
      await insert('A1', { available: false, detailsCollectedAt: null, fulfilled: false });
      await insert('A2', { detailsUrl: null, detailsCollectedAt: null, fulfilled: false });
      await insert('A3', { available: false, lastChangedRunId: new Types.ObjectId(RUN) });

      expect(await codesOf(10)).toEqual([]);
    });
  });

  describe('setCurrentRoundLabel: a compare-and-set (the clock never overwrites a collection)', () => {
    const label = async (code: string) =>
      (await h.kit.auctionModel.findOne({ code }).lean().exec())?.currentRoundLabel;

    it('moves the label only from the value the clock read', async () => {
      await insert('A1', { currentRoundLabel: '1º Leilão' });

      await h.properties.setCurrentRoundLabel('A1', 'Licitação', '2º Leilão'); // another value was read
      expect(await label('A1')).toBe('1º Leilão');
      await h.properties.setCurrentRoundLabel('A1', '1º Leilão', '2º Leilão');
      expect(await label('A1')).toBe('2º Leilão');
    });

    it('moves a never-recorded label only while it is still absent, and a null one from null', async () => {
      await insert('A1');
      await insert('A2', { currentRoundLabel: '1º Leilão' });
      await insert('A3', { currentRoundLabel: null });

      await h.properties.setCurrentRoundLabel('A1', undefined, '1º Leilão');
      await h.properties.setCurrentRoundLabel('A2', undefined, 'X'); // it was recorded meanwhile
      await h.properties.setCurrentRoundLabel('A3', null, '2º Leilão');

      expect([await label('A1'), await label('A2'), await label('A3')]).toEqual([
        '1º Leilão',
        '1º Leilão',
        '2º Leilão',
      ]);
    });
  });

  describe('applyCollection: the phase mirror', () => {
    const write = (overrides: Partial<CollectionWrite> = {}): CollectionWrite => ({
      now: NOW,
      phaseCount: 2,
      newVersions: [],
      touch: false,
      phaseDates: [new Date('2026-12-30T13:00:00Z')],
      paymentMethods: [],
      expenseRules: [{ type: 'Condomínio', description: 'Comprador.' }],
      ...overrides,
    });
    const twoPhases = {
      phases: [{ modality: 'SFI_AUCTION' }, { modality: 'OPEN_BIDDING' }],
      currentPhase: { modality: 'OPEN_BIDDING' },
    };

    it('writes the LAST phase and the current one, never the first', async () => {
      await insert('A1', twoPhases);

      await h.properties.applyCollection('A1', write());

      const doc = await h.kit.auctionModel.findOne({ code: 'A1' }).lean().exec();
      expect(doc?.phases?.[1]).toMatchObject({
        phaseDates: [new Date('2026-12-30T13:00:00Z')],
        expenseRules: [{ type: 'Condomínio' }],
      });
      expect(doc?.phases?.[0]).toEqual({ modality: 'SFI_AUCTION' });
      expect(doc?.currentPhase).toMatchObject({ phaseDates: [new Date('2026-12-30T13:00:00Z')] });
    });

    it('does not touch the phases when a phase was appended since they were read, but writes the rest', async () => {
      await insert('A1', twoPhases);

      await h.properties.applyCollection('A1', write({ phaseCount: 1, description: 'x' }));

      const doc = await h.kit.auctionModel.findOne({ code: 'A1' }).lean().exec();
      expect(doc?.phases).toEqual(twoPhases.phases); // the stale index would have priced the wrong phase
      expect(doc?.description).toBe('x');
      expect(doc?.detailsCollectedAt).toEqual(NOW);
    });

    it('skips the mirror for a property with no phase', async () => {
      await insert('A1', { phases: [], currentPhase: undefined });

      await h.properties.applyCollection('A1', write({ phaseCount: 0 }));

      expect((await h.kit.auctionModel.findOne({ code: 'A1' }).lean().exec())?.phases).toEqual([]);
    });
  });

  describe('markVersionChecked: only the version of that kind and content', () => {
    const version = (kind: 'EDITAL' | 'MATRICULA', hash: string) => ({
      kind,
      file: { originalUrl: 'u', mimeType: 'application/pdf' },
      sourceUrl: 'u',
      contentHash: hash,
      retrievedAt: new Date('2026-10-01T12:00:00Z'),
      checkedAt: new Date('2026-10-01T12:00:00Z'),
      publishedAt: null,
    });

    it('moves the check date (and the publication date) of the one version, leaving the others', async () => {
      await insert('A1', {
        documentVersions: [
          version('EDITAL', 'h1'),
          version('EDITAL', 'h2'),
          version('MATRICULA', 'h1'),
        ],
      });
      const published = new Date('2026-11-01T12:00:00Z');

      await h.properties.markVersionChecked(
        'A1',
        { kind: 'EDITAL', contentHash: 'h2', publishedAt: published },
        NOW,
      );

      const doc = await h.kit.auctionModel.findOne({ code: 'A1' }).lean().exec();
      expect(
        doc?.documentVersions?.map((v) => [
          v.kind,
          v.contentHash,
          v.checkedAt.toISOString(),
          v.publishedAt?.toISOString() ?? null,
        ]),
      ).toEqual([
        ['EDITAL', 'h1', '2026-10-01T12:00:00.000Z', null],
        ['EDITAL', 'h2', NOW.toISOString(), published.toISOString()],
        ['MATRICULA', 'h1', '2026-10-01T12:00:00.000Z', null],
      ]);
    });

    it('does not move a version of another kind that has the same content', async () => {
      await insert('A1', {
        documentVersions: [version('MATRICULA', 'same'), version('EDITAL', 'same')],
      });

      await h.properties.markVersionChecked(
        'A1',
        { kind: 'EDITAL', contentHash: 'same', publishedAt: null },
        NOW,
      );

      const doc = await h.kit.auctionModel.findOne({ code: 'A1' }).lean().exec();
      expect(doc?.documentVersions?.map((v) => [v.kind, v.checkedAt.toISOString()])).toEqual([
        ['MATRICULA', '2026-10-01T12:00:00.000Z'],
        ['EDITAL', NOW.toISOString()],
      ]);
    });

    it('leaves the publication date as it is when the page shows none', async () => {
      await insert('A1', {
        documentVersions: [
          { ...version('EDITAL', 'h1'), publishedAt: new Date('2026-09-01T12:00:00Z') },
        ],
      });

      await h.properties.markVersionChecked(
        'A1',
        { kind: 'EDITAL', contentHash: 'h1', publishedAt: null },
        NOW,
      );

      const doc = await h.kit.auctionModel.findOne({ code: 'A1' }).lean().exec();
      expect(doc?.documentVersions?.[0]?.publishedAt).toEqual(new Date('2026-09-01T12:00:00Z'));
    });
  });

  it('keeps a round price as Decimal128 through a write (AR-17)', async () => {
    await insert('A1');

    await h.properties.applyCollection('A1', {
      now: NOW,
      phaseCount: 1,
      newVersions: [],
      touch: false,
      rounds: [{ label: 'Licitação', date: null, minimumPrice: new Decimal('123456.78') }],
    });

    const doc = await h.kit.auctionModel.findOne({ code: 'A1' }).lean().exec();
    expect(doc?.rounds?.[0]?.minimumPrice?.toString()).toBe('123456.78');
  });
});
