// SPEC-009 BR-009-06: the protocol format. Hand-computed expectations (TS-04).
import { describe, expect, it } from 'vitest';
import { formatProtocol, protocolCounterKey } from './protocol.js';

describe('formatProtocol', () => {
  it('pads the sequence to six digits after the year', () => {
    expect(formatProtocol(2026, 1)).toBe('FL-2026-000001');
    expect(formatProtocol(2026, 42)).toBe('FL-2026-000042');
    expect(formatProtocol(2027, 999_999)).toBe('FL-2027-999999');
  });

  it('prints a sequence past six digits whole, never truncated', () => {
    expect(formatProtocol(2026, 1_000_000)).toBe('FL-2026-1000000');
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'refuses the sequence %s',
    (sequence) => {
      expect(() => formatProtocol(2026, sequence)).toThrow(RangeError);
    },
  );

  it.each([1999, 10_000, 2026.5, Number.NaN])('refuses the year %s', (year) => {
    expect(() => formatProtocol(year, 1)).toThrow(RangeError);
  });
});

describe('protocolCounterKey', () => {
  it('is one key per year', () => {
    expect(protocolCounterKey(2026)).toBe('support_protocol:2026');
    expect(protocolCounterKey(2027)).toBe('support_protocol:2027');
  });

  it('refuses a year that is not four digits', () => {
    expect(() => protocolCounterKey(26)).toThrow(RangeError);
  });
});
