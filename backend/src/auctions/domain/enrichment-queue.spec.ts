import { describe, expect, it } from 'vitest';
import {
  brasiliaDayStartBefore,
  type QueueCandidate,
  type QueueInput,
  refreshDueBefore,
  selectEnrichmentBatch,
} from './enrichment-queue.js';
import { brasiliaInstant } from './import-schedule.js';

// Calendar (Brasília, no DST): the pass runs on Tuesday 2026-11-24 at 10:00, so "today" starts at
// 2026-11-24T03:00:00Z. With N = 7 a property is due when it was collected on 2026-11-17 or
// earlier (due before 2026-11-18T00:00 Brasília = 2026-11-18T03:00:00Z).
const NOW = brasiliaInstant('2026-11-24', 600);
const RUN = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_RUN = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const at = (day: string, minutes = 0) => brasiliaInstant(day, minutes);

/** A collected, active, available property with a page; each spec states what it changes. */
function property(code: string, overrides: Partial<QueueCandidate> = {}): QueueCandidate {
  return {
    code,
    available: true,
    active: true,
    hasDetailsUrl: true,
    fulfilled: true,
    detailsCollectedAt: at('2026-11-20'),
    lastChangedRunId: null,
    detailsRetryAfter: null,
    detailsFailures: 0,
    ...overrides,
  };
}

const input = (overrides: Partial<QueueInput> = {}): QueueInput => ({
  runId: RUN,
  now: NOW,
  budget: 100,
  maxStalenessDays: 7,
  ...overrides,
});

const codes = (batch: { code: string }[]) => batch.map((entry) => entry.code);

describe('the staleness boundary (BR-004-19)', () => {
  it('starts the Brasília day the given number of days before now', () => {
    expect(brasiliaDayStartBefore(NOW, 0)).toEqual(new Date('2026-11-24T03:00:00.000Z'));
    expect(brasiliaDayStartBefore(NOW, 6)).toEqual(new Date('2026-11-18T03:00:00.000Z'));
  });

  it('counts the day just before midnight in Brasília as that day, not the UTC one', () => {
    // 2026-11-25T01:30Z is still 2026-11-24 22:30 in Brasília.
    expect(brasiliaDayStartBefore(new Date('2026-11-25T01:30:00.000Z'), 0)).toEqual(
      new Date('2026-11-24T03:00:00.000Z'),
    );
  });

  it('is due for data collected before the day N-1 days back began', () => {
    expect(refreshDueBefore(NOW, 7)).toEqual(new Date('2026-11-18T03:00:00.000Z'));
    expect(refreshDueBefore(NOW, 1)).toEqual(new Date('2026-11-24T03:00:00.000Z'));
  });
});

describe('selectEnrichmentBatch: the order (BR-004-19)', () => {
  it('puts new and returned first, then changed today, then the oldest refreshes', () => {
    const batch = selectEnrichmentBatch(
      [
        property('0005', { detailsCollectedAt: at('2026-11-10') }), // refresh, 14 days old
        property('0004', { lastChangedRunId: RUN, detailsCollectedAt: at('2026-11-23') }), // changed
        property('0003', { detailsCollectedAt: null, fulfilled: false }), // new
        property('0002', { detailsCollectedAt: at('2026-11-12') }), // refresh, 12 days old
        property('0001', { fulfilled: false }), // returned: details dropped
      ],
      input(),
    );

    expect(batch).toEqual([
      { code: '0001', tier: 'NEW' },
      { code: '0003', tier: 'NEW' },
      { code: '0004', tier: 'CHANGED' },
      { code: '0005', tier: 'REFRESH' }, // 11-10 is older than 11-12
      { code: '0002', tier: 'REFRESH' },
    ]);
  });

  it('orders the refreshes by age whatever order they were read in, ties by number', () => {
    const batch = selectEnrichmentBatch(
      [
        property('0003', { detailsCollectedAt: at('2026-11-15') }),
        property('0002', { detailsCollectedAt: at('2026-11-15') }),
        property('0001', { detailsCollectedAt: at('2026-11-16') }),
        property('0004', { detailsCollectedAt: at('2026-11-01') }),
      ],
      input(),
    );

    expect(codes(batch)).toEqual(['0004', '0002', '0003', '0001']);
  });

  it('puts a changed property that is also stale in CHANGED, once', () => {
    const batch = selectEnrichmentBatch(
      [property('0001', { lastChangedRunId: RUN, detailsCollectedAt: at('2026-11-01') })],
      input(),
    );

    expect(batch).toEqual([{ code: '0001', tier: 'CHANGED' }]);
  });

  it('does not treat a row another run changed as changed today', () => {
    const batch = selectEnrichmentBatch(
      [property('0001', { lastChangedRunId: OTHER_RUN, detailsCollectedAt: at('2026-11-23') })],
      input(),
    );

    expect(batch).toEqual([]);
  });

  it('queues a property once even if two queries found it', () => {
    const batch = selectEnrichmentBatch(
      [property('0001', { fulfilled: false }), property('0001', { fulfilled: false })],
      input(),
    );

    expect(batch).toEqual([{ code: '0001', tier: 'NEW' }]);
  });
});

describe('selectEnrichmentBatch: the budget', () => {
  const sixNew = Array.from({ length: 6 }, (_, index) =>
    property(`000${index + 1}`, { detailsCollectedAt: null, fulfilled: false }),
  );

  it('stops at the budget, new properties before any refresh', () => {
    const batch = selectEnrichmentBatch(
      [property('0000', { detailsCollectedAt: at('2026-10-01') }), ...sixNew],
      input({ budget: 4 }),
    );

    expect(codes(batch)).toEqual(['0001', '0002', '0003', '0004']);
  });

  it('takes the whole queue when the budget covers it', () => {
    expect(selectEnrichmentBatch(sixNew, input({ budget: 6 }))).toHaveLength(6);
    expect(selectEnrichmentBatch(sixNew, input({ budget: 60 }))).toHaveLength(6);
  });

  it('rounds a fractional budget down', () => {
    expect(selectEnrichmentBatch(sixNew, input({ budget: 2.9 }))).toHaveLength(2);
  });

  it.each([0, -3, Number.NaN])('collects nothing with a budget of %s', (budget) => {
    expect(selectEnrichmentBatch(sixNew, input({ budget }))).toEqual([]);
  });

  it('collects nothing from an empty catalogue', () => {
    expect(selectEnrichmentBatch([], input())).toEqual([]);
  });
});

describe('selectEnrichmentBatch: what is never collected', () => {
  it('skips a property the list marks unavailable, in every tier (BR-004-08)', () => {
    const batch = selectEnrichmentBatch(
      [
        property('0001', { available: false, detailsCollectedAt: null, fulfilled: false }),
        property('0002', { available: false, lastChangedRunId: RUN }),
        property('0003', { available: false, detailsCollectedAt: at('2026-10-01') }),
      ],
      input(),
    );

    expect(batch).toEqual([]);
  });

  it('skips a property with no page to ask for', () => {
    expect(
      selectEnrichmentBatch(
        [property('0001', { hasDetailsUrl: false, detailsCollectedAt: null, fulfilled: false })],
        input(),
      ),
    ).toEqual([]);
  });

  it('skips a property in back-off until its retry time, then queues it again (BR-004-21)', () => {
    const waiting = property('0001', {
      detailsCollectedAt: null,
      fulfilled: false,
      detailsRetryAfter: new Date(NOW.getTime() + 1),
    });
    const due = property('0002', {
      detailsCollectedAt: null,
      fulfilled: false,
      detailsRetryAfter: NOW, // at the instant: the wait is over
    });
    const earlier = property('0003', {
      detailsCollectedAt: null,
      fulfilled: false,
      detailsRetryAfter: new Date(NOW.getTime() - 1),
    });

    expect(codes(selectEnrichmentBatch([waiting, due, earlier], input()))).toEqual([
      '0002',
      '0003',
    ]);
  });

  it('skips a property already collected on today’s Brasília day, even if its row changed', () => {
    const batch = selectEnrichmentBatch(
      [
        property('0001', { detailsCollectedAt: at('2026-11-24', 1), lastChangedRunId: RUN }),
        property('0002', { detailsCollectedAt: at('2026-11-24', 599) }),
      ],
      input(),
    );

    expect(batch).toEqual([]);
  });

  it('collects data from just before midnight yesterday again when its row changed', () => {
    const batch = selectEnrichmentBatch(
      [
        property('0001', {
          detailsCollectedAt: at('2026-11-23', 23 * 60 + 59),
          lastChangedRunId: RUN,
        }),
      ],
      input(),
    );

    expect(batch).toEqual([{ code: '0001', tier: 'CHANGED' }]);
  });

  it('refreshes only active properties, and only once N days old', () => {
    const batch = selectEnrichmentBatch(
      [
        property('0001', { active: false, detailsCollectedAt: at('2026-10-01') }),
        property('0002', { detailsCollectedAt: at('2026-11-17', 23 * 60 + 59) }), // due
        property('0003', { detailsCollectedAt: at('2026-11-18') }), // due tomorrow
        property('0004', { detailsCollectedAt: at('2026-11-23') }),
      ],
      input(),
    );

    expect(batch).toEqual([{ code: '0002', tier: 'REFRESH' }]);
  });

  it('retries a property whose last collection failed once its back-off is over, even if its data is recent', () => {
    const batch = selectEnrichmentBatch(
      [
        property('0001', { detailsCollectedAt: at('2026-11-23'), detailsFailures: 2 }),
        property('0002', { detailsCollectedAt: at('2026-11-23'), detailsFailures: 0 }),
        property('0003', {
          detailsCollectedAt: at('2026-11-23'),
          detailsFailures: 1,
          active: false,
        }),
        property('0004', {
          detailsCollectedAt: at('2026-11-23'),
          detailsFailures: 1,
          detailsRetryAfter: new Date(NOW.getTime() + 1),
        }),
      ],
      input(),
    );

    expect(batch).toEqual([{ code: '0001', tier: 'REFRESH' }]);
  });

  it('refreshes every day when N is one', () => {
    const batch = selectEnrichmentBatch(
      [
        property('0001', { detailsCollectedAt: at('2026-11-23', 23 * 60) }),
        property('0002', { detailsCollectedAt: at('2026-11-24') }),
      ],
      input({ maxStalenessDays: 1 }),
    );

    expect(batch).toEqual([{ code: '0001', tier: 'REFRESH' }]);
  });
});

describe('the staleness bound over many days (BR-004-19, DL-004-09)', () => {
  it('keeps every property within N days when the budget covers catalogue / N', () => {
    // 21 properties, N = 7: a budget of 3 a day is exactly catalogue / N. All start never
    // collected (NEW), then settle into the rolling refresh.
    const N = 7;
    const store = new Map<string, Date | null>();
    for (let index = 0; index < 21; index++) {
      store.set(`P${String(index).padStart(2, '0')}`, null);
    }
    const worstAge: number[] = [];
    for (let day = 0; day < 40; day++) {
      const date = new Date(Date.UTC(2026, 10, 1 + day, 12)); // 09:00 Brasília
      const batch = selectEnrichmentBatch(
        [...store].map(([code, collectedAt]) =>
          property(code, { detailsCollectedAt: collectedAt, fulfilled: collectedAt !== null }),
        ),
        input({ now: date, budget: 3, maxStalenessDays: N }),
      );
      for (const entry of batch) store.set(entry.code, date);
      if (day >= 7) {
        const oldest = Math.min(...[...store.values()].map((value) => value?.getTime() ?? 0));
        worstAge.push(Math.round((date.getTime() - oldest) / 86_400_000));
      }
    }

    // From day 7 on, nothing was ever more than N days old at the end of a day's pass.
    expect(Math.max(...worstAge)).toBeLessThanOrEqual(N);
  });
});
