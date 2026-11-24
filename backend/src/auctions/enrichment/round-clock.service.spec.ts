// SPEC-004 BR-004-13, BR-004-26: the round clock over fakes (TS-07): which entries it records and
// which recorded rounds it moves, chunk by chunk. The SFI case against MongoDB is in
// test/integration/round-clock.spec.ts.
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../test/fakes/fake-clock.js';
import { FakeEnrichmentRepository } from '../../../test/fakes/fake-enrichment-repository.js';
import { spyOnLogger } from '../../../test/support/logger-spy.js';
import { Decimal } from '../../common/money/money.js';
import type { PropertyChangeService } from '../changes/property-change.service.js';
import type { ChangeDraft } from '../domain/change-types.js';
import type { Round } from '../domain/rounds.js';
import type { EnrichmentRepository } from './enrichment.repository.js';
import { CLOCK_CHUNK_SIZE, RoundClockService } from './round-clock.service.js';

const NOW = new Date('2026-11-24T14:00:00.000Z'); // after the 1st round, before the 2nd
const SFI: Round[] = [
  {
    label: '1º Leilão',
    date: new Date('2026-11-24T13:00:00.000Z'),
    minimumPrice: new Decimal('100.00'),
  },
  {
    label: '2º Leilão',
    date: new Date('2026-11-30T13:00:00.000Z'),
    minimumPrice: new Decimal('80.00'),
  },
];

function setup() {
  const repository = new FakeEnrichmentRepository();
  const recorded: { runId: string; drafts: readonly ChangeDraft[] }[] = [];
  const changes = {
    record: async (runId: string, drafts: readonly ChangeDraft[]) => {
      repository.calls.push('record');
      recorded.push({ runId, drafts });
    },
  } as unknown as PropertyChangeService;
  const service = new RoundClockService(
    repository as unknown as EnrichmentRepository,
    changes,
    new FakeClock(NOW),
  );
  return { repository, recorded, service };
}
const held = () => Promise.resolve();

describe('RoundClockService', () => {
  it('records the changes first and then moves the recorded round, guarded by what it read', async () => {
    const { repository, recorded, service } = setup();
    repository.clockCandidates = [
      { code: '0001', rounds: SFI, currentRoundLabel: '1º Leilão' },
      { code: '0002', rounds: SFI, currentRoundLabel: '2º Leilão' }, // already moved
      { code: '0003', rounds: SFI, currentRoundLabel: undefined }, // never recorded
    ];

    const count = await service.record({ importRunId: 'run-1', assertHeld: held });

    expect(count).toBe(2); // the round change and the price drop of 0001
    expect(
      recorded.map((entry) => entry.drafts.map((draft) => [draft.propertyCode, draft.type])),
    ).toEqual([
      [
        ['0001', 'MODALITY_OR_ROUND_CHANGED'],
        ['0001', 'PRICE_DROPPED'],
      ],
    ]);
    expect(repository.labelMoves).toEqual([
      { code: '0001', expected: '1º Leilão', label: '2º Leilão' },
      { code: '0003', expected: undefined, label: '2º Leilão' },
    ]);
    // The entries come first: a crash between the two leaves entries the retry records again.
    expect(repository.calls).toEqual(['record']);
  });

  it('checks the lease before every chunk and reads chunk after chunk until none is left', async () => {
    const { repository, service } = setup();
    repository.clockCandidates = Array.from({ length: CLOCK_CHUNK_SIZE + 5 }, (_, index) => ({
      code: String(index + 1).padStart(5, '0'),
      rounds: SFI,
      currentRoundLabel: '2º Leilão',
    }));
    let checks = 0;

    const count = await service.record({
      importRunId: 'run-1',
      assertHeld: () => {
        checks++;
        return Promise.resolve();
      },
    });

    expect(count).toBe(0);
    expect(checks).toBe(3); // two chunks and the empty one that ends it
  });

  it('stops where the lease was lost: nothing more is read or written', async () => {
    const { repository, recorded, service } = setup();
    repository.clockCandidates = [{ code: '0001', rounds: SFI, currentRoundLabel: '1º Leilão' }];

    await expect(
      service.record({ importRunId: 'run-1', assertHeld: () => Promise.reject(new Error('lost')) }),
    ).rejects.toThrow('lost');

    expect(recorded).toEqual([]);
    expect(repository.labelMoves).toEqual([]);
  });

  it('logs only a count (SC-15)', async () => {
    const logged = spyOnLogger();
    const { repository, service } = setup();
    repository.clockCandidates = [{ code: '0001', rounds: SFI, currentRoundLabel: '1º Leilão' }];

    await service.record({ importRunId: 'run-1', assertHeld: held });

    expect(logged.loggedText()).toContain('recorded 2 round change entries');
    expect(logged.loggedText()).not.toContain('0001');
  });
});
