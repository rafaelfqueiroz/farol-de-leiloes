// SPEC-004 BR-004-11, BR-004-15, BR-004-25: what is written for a collected page, and in which
// order. The repository and the change service are fakes that record (TS-03, TS-07).
import { describe, expect, it } from 'vitest';
import {
  aStoredProperty,
  FakeEnrichmentRepository,
} from '../../../test/fakes/fake-enrichment-repository.js';
import { Decimal } from '../../common/money/money.js';
import type { PropertyChangeService } from '../changes/property-change.service.js';
import type { ChangeDraft } from '../domain/change-types.js';
import { type DetailPage, PaymentMethod } from '../domain/detail-data.js';
import { PhaseModality } from '../domain/modality.js';
import { DetailApplier } from './detail-applier.js';
import type { EnrichmentRepository } from './enrichment.repository.js';
import type { PropertyCopies } from './property-copier.js';

const NOW = new Date('2026-11-24T12:00:00.000Z');
const D1 = new Date('2026-12-15T13:00:00.000Z');
const D2 = new Date('2026-12-21T13:00:00.000Z');

const page = (overrides: Partial<DetailPage> = {}): DetailPage => ({
  description: null,
  propertyType: null,
  occupancy: null,
  phaseDates: [],
  prices: { first: null, second: null, single: null },
  paymentMethods: null,
  expenseRules: null,
  photoUrls: [],
  matriculaUrl: null,
  editalUrl: null,
  editalPublishedAt: null,
  ...overrides,
});
const noCopies = (): PropertyCopies => ({
  newVersions: [],
  checked: [],
  entries: [],
  rejections: [],
});

function setup() {
  const repository = new FakeEnrichmentRepository();
  const recorded: { runId: string; drafts: readonly ChangeDraft[]; now: Date }[] = [];
  const changes = {
    record: async (runId: string, drafts: readonly ChangeDraft[], now: Date) => {
      repository.calls.push('record');
      recorded.push({ runId, drafts, now });
    },
  } as unknown as PropertyChangeService;
  const applier = new DetailApplier(changes, repository as unknown as EnrichmentRepository);
  return { repository, recorded, applier };
}

describe('DetailApplier', () => {
  it('writes only what the page states, stamps the collection and resets the failure counters', async () => {
    const { repository, applier } = setup();

    const entries = await applier.apply({
      runId: 'run-1',
      stored: aStoredProperty('0001', { propertyType: 'Casa', occupancy: 'OCCUPIED' }),
      page: page({ description: 'Sala e cozinha.' }),
      copies: noCopies(),
      now: NOW,
    });

    expect(entries).toBe(0);
    expect(repository.applied).toEqual([
      {
        code: '0001',
        write: {
          now: NOW,
          phaseCount: 1,
          newVersions: [],
          touch: true,
          description: 'Sala e cozinha.',
        },
      },
    ]);
  });

  it('writes the rounds by the list modality, with their prices, the current label and the phase mirror', async () => {
    const { repository, applier } = setup();

    await applier.apply({
      runId: 'run-1',
      stored: aStoredProperty('0001', { modality: PhaseModality.SFI_AUCTION }),
      page: page({
        phaseDates: [D1, D2],
        prices: { first: new Decimal('100.00'), second: new Decimal('80.00'), single: null },
        propertyType: 'Sobrado',
        occupancy: 'UNOCCUPIED',
        paymentMethods: [PaymentMethod.FGTS],
        expenseRules: [{ type: 'Condomínio', description: 'Comprador.' }],
      }),
      copies: noCopies(),
      now: NOW,
    });

    expect(repository.applied[0]?.write).toMatchObject({
      rounds: [
        { label: '1º Leilão', date: D1, minimumPrice: new Decimal('100.00') },
        { label: '2º Leilão', date: D2, minimumPrice: new Decimal('80.00') },
      ],
      currentRoundLabel: '1º Leilão',
      phaseDates: [D1, D2],
      propertyType: 'Sobrado',
      occupancy: 'UNOCCUPIED',
      paymentMethods: ['FGTS'],
      expenseRules: [{ type: 'Condomínio', description: 'Comprador.' }],
    });
  });

  it('records a null round label when every date has passed', async () => {
    const { repository, applier } = setup();

    await applier.apply({
      runId: 'run-1',
      stored: aStoredProperty('0001', { modality: PhaseModality.OPEN_BIDDING }),
      page: page({ phaseDates: [new Date('2026-01-01T13:00:00.000Z')] }),
      copies: noCopies(),
      now: NOW,
    });

    expect(repository.applied[0]?.write.currentRoundLabel).toBeNull();
  });

  it('writes no rounds for a property with no modality, or a page with no dates for a dated one', async () => {
    const { repository, applier } = setup();

    await applier.apply({
      runId: 'r',
      stored: aStoredProperty('0001'),
      page: page({ phaseDates: [D1] }),
      copies: noCopies(),
      now: NOW,
    });
    await applier.apply({
      runId: 'r',
      stored: aStoredProperty('0002', { modality: PhaseModality.SFI_AUCTION }),
      page: page(),
      copies: noCopies(),
      now: NOW,
    });

    expect(repository.applied.map((entry) => entry.write.rounds)).toEqual([undefined, undefined]);
    expect(repository.applied.map((entry) => entry.write.phaseDates)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('writes the copies and versions it was given, and marks the versions that were checked', async () => {
    const { repository, applier } = setup();
    const file = { originalUrl: 'u', mimeType: 'application/pdf', storageKey: 'k' };

    await applier.apply({
      runId: 'r',
      stored: aStoredProperty('0001'),
      page: page(),
      copies: {
        photos: [file],
        edital: file,
        matricula: file,
        newVersions: [],
        checked: [{ kind: 'EDITAL', contentHash: 'h', publishedAt: null }],
        entries: [],
        rejections: [],
      },
      now: NOW,
    });

    expect(repository.applied[0]?.write).toMatchObject({
      photos: [file],
      edital: file,
      matricula: file,
    });
    expect(repository.checked).toEqual([{ code: '0001', kind: 'EDITAL', contentHash: 'h' }]);
  });

  it('records the entries before it writes the property, and counts them, copy entries included', async () => {
    const { repository, recorded, applier } = setup();
    const replaced: ChangeDraft = {
      propertyCode: '0001',
      source: 'DETAILS',
      type: 'OTHER_FIELD',
      relevant: false,
      field: 'edital',
      oldValue: 'a',
      newValue: 'b',
    };

    const count = await applier.apply({
      runId: 'run-9',
      stored: aStoredProperty('0001', {
        detailsCollectedAt: new Date('2026-11-20T12:00:00Z'),
        paymentMethods: [PaymentMethod.OWN_RESOURCES],
      }),
      page: page({ paymentMethods: [PaymentMethod.OWN_RESOURCES, PaymentMethod.FINANCING] }),
      copies: { ...noCopies(), entries: [replaced] },
      now: NOW,
    });

    expect(count).toBe(2);
    expect(repository.calls).toEqual(['record', 'applyCollection']);
    expect(recorded[0]?.runId).toBe('run-9');
    expect(recorded[0]?.drafts.map((draft) => draft.type)).toEqual([
      'STARTED_FINANCING',
      'OTHER_FIELD',
    ]);
    expect(repository.applied[0]?.write.touch).toBe(true);
  });

  it('does not move the property when nothing changed on a property already collected', async () => {
    const { repository, applier } = setup();

    await applier.apply({
      runId: 'r',
      stored: aStoredProperty('0001', { detailsCollectedAt: new Date('2026-11-20T12:00:00Z') }),
      page: page({ description: '' }),
      copies: noCopies(),
      now: NOW,
    });

    expect(repository.applied[0]?.write.touch).toBe(false);
    expect(repository.applied[0]?.write.description).toBeUndefined(); // an empty text is not a description
  });

  it("records the clock's round change itself when it moves the recorded round (the 1st round ended since the last look)", async () => {
    const { repository, recorded, applier } = setup();
    const first = {
      label: '1º Leilão',
      date: new Date('2026-11-24T11:00:00.000Z'),
      minimumPrice: new Decimal('100.00'),
    };
    const second = { label: '2º Leilão', date: D2, minimumPrice: new Decimal('80.00') };

    const count = await applier.apply({
      runId: 'run-1',
      stored: aStoredProperty('0001', {
        modality: PhaseModality.SFI_AUCTION,
        rounds: [first, second],
        currentRoundLabel: '1º Leilão',
        detailsCollectedAt: new Date('2026-11-23T12:00:00Z'),
      }),
      page: page({
        phaseDates: [first.date, second.date],
        prices: { first: first.minimumPrice, second: second.minimumPrice, single: null },
      }),
      copies: noCopies(),
      now: NOW, // after the 1st round, before the 2nd
    });

    expect(count).toBe(2);
    expect(recorded[0]?.drafts.map((draft) => [draft.source, draft.type])).toEqual([
      ['CLOCK', 'MODALITY_OR_ROUND_CHANGED'],
      ['CLOCK', 'PRICE_DROPPED'],
    ]);
    expect(repository.applied[0]?.write.currentRoundLabel).toBe('2º Leilão');
  });

  it("moves the recorded round even when the page gives no dates, so the clock's change is not lost", async () => {
    const { repository, applier } = setup();
    const first = {
      label: '1º Leilão',
      date: new Date('2026-11-24T11:00:00.000Z'),
      minimumPrice: null,
    };
    const second = { label: '2º Leilão', date: D2, minimumPrice: null };

    await applier.apply({
      runId: 'run-1',
      stored: aStoredProperty('0001', {
        modality: PhaseModality.SFI_AUCTION,
        rounds: [first, second],
        currentRoundLabel: '1º Leilão',
      }),
      page: page(),
      copies: noCopies(),
      now: NOW,
    });

    expect(repository.applied[0]?.write.rounds).toBeUndefined();
    expect(repository.applied[0]?.write.currentRoundLabel).toBe('2º Leilão');
  });
});
