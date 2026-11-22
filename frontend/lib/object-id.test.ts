import { describe, expect, it } from 'vitest';
import { isObjectId } from './object-id';

describe('isObjectId', () => {
  it.each(['64b7f0000000000000000a01', 'a'.repeat(24)])('accepts %s', (value) => {
    expect(isObjectId(value)).toBe(true);
  });

  it.each([
    '',
    '64B7F0000000000000000A01',
    '..',
    '%2e%2e',
    '../x',
    'a/b',
    '64b7f0000000000000000a0',
    '64b7f0000000000000000a011',
    '64b7f0000000000000000a0g',
    '64b7f000000000000000 a01',
    undefined,
    null,
    24,
  ])('refuses %j', (value) => {
    expect(isObjectId(value)).toBe(false);
  });
});
