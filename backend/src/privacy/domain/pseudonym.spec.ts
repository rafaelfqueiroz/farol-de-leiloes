// SPEC-010 BR-010-28: the pseudonym is the random bytes and nothing else (hand-written, TS-04).
import { describe, expect, it } from 'vitest';
import { PSEUDONYM_MIN_BYTES, pseudonymFromBytes } from './pseudonym.js';

describe('BR-010-28: the pseudonym', () => {
  it('is p- and the 16 bytes as lower-case hex (0x00 0x01 ... 0x0f -> 32 characters)', () => {
    const bytes = Uint8Array.from({ length: 16 }, (_, i) => i);
    expect(pseudonymFromBytes(bytes)).toBe('p-000102030405060708090a0b0c0d0e0f');
  });

  it('uses every byte it is given (20 bytes -> 40 hex characters)', () => {
    expect(pseudonymFromBytes(new Uint8Array(20).fill(255))).toBe(`p-${'ff'.repeat(20)}`);
  });

  it('refuses fewer than 128 bits', () => {
    expect(PSEUDONYM_MIN_BYTES).toBe(16);
    expect(() => pseudonymFromBytes(new Uint8Array(15))).toThrow(RangeError);
    expect(() => pseudonymFromBytes(new Uint8Array(0))).toThrow(RangeError);
  });
});
