import { describe, expect, it } from 'vitest';
import { isReservedEmailDomain, normalizeEmail } from './normalize-email.js';

describe('normalizeEmail', () => {
  it('BR-001-01: trims and lower-cases', () => {
    expect(normalizeEmail('  Ana@Exemplo.COM ')).toBe('ana@exemplo.com');
  });
});

describe('isReservedEmailDomain (BR-010-15: the purge tombstone namespace)', () => {
  it.each([
    ['purged-1@removed.invalid', true],
    ['a@x.INVALID', true],
    ['a@invalid', true],
    ['a@removed.invalid.', true],
    ['a@removed.invalid...', true],
    ['a@exemplo.com', false],
    ['a@exemplo.com.', false],
    ['a@invalid.example.com', false],
    ['no-at-sign', false],
  ])('%s -> %s', (email, expected) => {
    expect(isReservedEmailDomain(email)).toBe(expected);
  });

  it('js/polynomial-redos: a very long run of dots is handled in linear time', () => {
    const started = Date.now();
    expect(isReservedEmailDomain(`a@x${'.'.repeat(200_000)}`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
