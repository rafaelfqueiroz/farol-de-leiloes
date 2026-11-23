// SPEC-009 BR-009-06 (decision 2 of #9): the protocol number of a support request, `FL-YYYY-NNNNNN`.
// Pure (AR-05): the year is the one the caller read from the injected Clock in Brasília time
// (AR-23, AR-24) and the sequence is the one the atomic per-year counter handed out; this file only
// shapes them, so the format is one thing in one place.

export const PROTOCOL_PREFIX = 'FL';
const SEQUENCE_DIGITS = 6;

/** The key of the per-year counter: one sequence per calendar year (Brasília time). */
export function protocolCounterKey(year: number): string {
  assertYear(year);
  return `support_protocol:${year}`;
}

/**
 * `FL-2026-000042`: the year, then the sequence padded to six digits. A sequence past 999999 is
 * printed with its extra digits rather than truncated (a protocol is never ambiguous); nothing in the
 * product reads the format back.
 */
export function formatProtocol(year: number, sequence: number): string {
  assertYear(year);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RangeError('A protocol sequence is a positive integer');
  }
  return `${PROTOCOL_PREFIX}-${year}-${String(sequence).padStart(SEQUENCE_DIGITS, '0')}`;
}

function assertYear(year: number): void {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new RangeError('A protocol year has four digits, from 2000');
  }
}
