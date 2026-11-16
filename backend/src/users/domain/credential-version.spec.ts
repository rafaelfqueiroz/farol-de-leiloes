// DL-001-02: a missing credential version is the same as 0 on both sides of the comparison.
import { describe, expect, it } from 'vitest';
import { credentialVersionOf } from './credential-version.js';

describe('credentialVersionOf', () => {
  it.each<[string, { credentialVersion?: number | null }, number]>([
    ['a stored version', { credentialVersion: 3 }, 3],
    ['a stored zero', { credentialVersion: 0 }, 0],
    ['a missing version counts as 0', {}, 0],
    ['a null version counts as 0', { credentialVersion: null }, 0],
  ])('%s', (_label, account, expected) => {
    expect(credentialVersionOf(account)).toBe(expected);
  });
});
