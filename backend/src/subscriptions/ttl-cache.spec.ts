import { describe, expect, it } from 'vitest';
import { TtlCache } from './ttl-cache.js';

describe('TtlCache', () => {
  it('answers a value until it expires, by the instant given', () => {
    const cache = new TtlCache<string>(10);
    cache.set('a', 'x', 1000, 500);

    expect(cache.get('a', 1499)).toBe('x');
    expect(cache.get('a', 1500)).toBeUndefined();
    expect(cache.get('missing', 1000)).toBeUndefined();
  });

  it('evicts every expired entry when something is written', () => {
    const cache = new TtlCache<number>(10);
    cache.set('old1', 1, 0, 100);
    cache.set('old2', 2, 0, 100);
    cache.set('fresh', 3, 50, 1000);

    cache.set('new', 4, 200, 1000);

    expect(cache.size).toBe(2);
    expect(cache.get('fresh', 200)).toBe(3);
    expect(cache.get('new', 200)).toBe(4);
  });

  it('never holds more than its cap, dropping the oldest first', () => {
    const cache = new TtlCache<number>(3);
    for (let i = 0; i < 10; i += 1) cache.set(`k${i}`, i, 0, 1000);

    expect(cache.size).toBe(3);
    expect(cache.get('k6', 1)).toBeUndefined();
    expect(cache.get('k7', 1)).toBe(7);
    expect(cache.get('k9', 1)).toBe(9);
  });

  it('a rewritten key is the newest, and replaces the old value', () => {
    const cache = new TtlCache<number>(2);
    cache.set('a', 1, 0, 1000);
    cache.set('b', 2, 0, 1000);
    cache.set('a', 3, 0, 1000);
    cache.set('c', 4, 0, 1000);

    expect(cache.get('a', 1)).toBe(3);
    expect(cache.get('b', 1)).toBeUndefined();
  });

  it('deletes one key, or every key under a prefix', () => {
    const cache = new TtlCache<number>(10);
    cache.set('sub1:a', 1, 0, 1000);
    cache.set('sub1:b', 2, 0, 1000);
    cache.set('sub2:a', 3, 0, 1000);

    cache.delete('sub2:a');
    cache.deleteByPrefix('sub1:');

    expect(cache.size).toBe(0);
  });
});
