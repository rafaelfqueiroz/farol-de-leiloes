import { describe, expect, it } from 'vitest';
import { QUOTE_TTL_MS, judgeQuoteDate, quoteExpiresAt } from './plan-quote.js';

const at = (iso: string) => new Date(iso);
const START = at('2026-03-01T12:00:00.000Z');
const END = at('2026-03-31T12:00:00.000Z');
const PINNED = at('2026-03-10T12:00:00.000Z');
const judge = (
  now: Date,
  prorationDate = PINNED,
  bounds: { periodStart: Date | null; periodEnd: Date | null } = {
    periodStart: START,
    periodEnd: END,
  },
) => judgeQuoteDate({ prorationDate, now, ...bounds });

describe('plan quote (BR-012-16)', () => {
  it('is good for two minutes from the pinned instant', () => {
    expect(QUOTE_TTL_MS).toBe(120_000);
    expect(quoteExpiresAt(PINNED).toISOString()).toBe('2026-03-10T12:02:00.000Z');
  });

  it('accepts a date pinned now and one still inside its time to live', () => {
    expect(judge(PINNED)).toBe('ok');
    expect(judge(at('2026-03-10T12:01:59.999Z'))).toBe('ok');
  });

  it('is expired from exactly the time to live on', () => {
    expect(judge(at('2026-03-10T12:02:00.000Z'))).toBe('expired');
    expect(judge(at('2026-03-10T13:00:00.000Z'))).toBe('expired');
  });

  it('refuses a date after now: we never pinned it', () => {
    expect(judge(PINNED, at('2026-03-10T12:00:01.000Z'))).toBe('from_the_future');
  });

  it('refuses a date before the period started (the subscription renewed since) or at its end', () => {
    expect(
      judge(at('2026-03-31T12:00:30.000Z'), at('2026-03-31T11:59:59.000Z'), {
        periodStart: at('2026-03-31T12:00:00.000Z'),
        periodEnd: at('2026-04-30T12:00:00.000Z'),
      }),
    ).toBe('outside_period');
    expect(
      judge(at('2026-03-31T12:00:30.000Z'), at('2026-03-31T12:00:00.000Z'), {
        periodStart: START,
        periodEnd: at('2026-03-31T12:00:00.000Z'),
      }),
    ).toBe('outside_period');
  });

  it('accepts the first instant of the period', () => {
    expect(judge(START, START)).toBe('ok');
  });

  it('judges by the time alone when the period is unknown', () => {
    const open = { periodStart: null, periodEnd: null };
    expect(judge(PINNED, PINNED, open)).toBe('ok');
    expect(judge(at('2026-03-10T12:02:00.000Z'), PINNED, open)).toBe('expired');
  });
});
