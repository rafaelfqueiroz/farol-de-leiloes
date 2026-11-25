import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NO_SEARCH_HASH, SEARCH_HASH_LENGTH, searchLogQuery } from './search-log-query.js';

const KEY = 'a-test-key-that-is-not-a-real-one-0000000';

describe('BR-009-14: the log value of an account search', () => {
  it('is <kind>:<length>:<hmac>, with the length in characters of the normalised terms', () => {
    const value = searchLogQuery(KEY, 'name', 'maria silva');

    const [kind, length, hash] = value.split(':');
    expect(kind).toBe('name');
    expect(length).toBe('11');
    expect(hash).toHaveLength(SEARCH_HASH_LENGTH);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('the hash is the first 32 hex characters of HMAC-SHA256 over "account_search:" and the terms', () => {
    const expected = createHmac('sha256', KEY)
      .update('account_search:ana@exemplo.test')
      .digest('hex')
      .slice(0, 32);

    expect(searchLogQuery(KEY, 'email', 'ana@exemplo.test')).toBe(`email:16:${expected}`);
  });

  it('the same terms give the same value, other terms or another key give another', () => {
    const base = searchLogQuery(KEY, 'name', 'maria');

    expect(searchLogQuery(KEY, 'name', 'maria')).toBe(base);
    expect(searchLogQuery(KEY, 'name', 'mario')).not.toBe(base);
    expect(searchLogQuery(`${KEY}x`, 'name', 'maria')).not.toBe(base);
  });

  it('never contains the terms, however short', () => {
    const value = searchLogQuery(KEY, 'email', 'maria@exemplo.test');

    expect(value).not.toContain('maria');
    expect(value).not.toContain('exemplo');
  });

  it('counts the length in characters, not bytes', () => {
    expect(searchLogQuery(KEY, 'name', 'joão').split(':')[1]).toBe('4');
  });

  it('without a key writes no hash at all: an unkeyed hash of a name could be guessed from the log', () => {
    expect(searchLogQuery(undefined, 'name', 'maria')).toBe(`name:5:${NO_SEARCH_HASH}`);
    expect(searchLogQuery('', 'email', 'a@b.test')).toBe(`email:8:${NO_SEARCH_HASH}`);
  });
});
