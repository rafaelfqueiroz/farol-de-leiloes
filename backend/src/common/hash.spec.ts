import { describe, expect, it } from 'vitest';
import { createStableId } from './hash.js';

describe('createStableId', () => {
  // SHA-1 of the JSON text '{"a":1,"b":2}', computed independently with `printf | shasum`.
  const SHA1_OF_A1_B2 = '4acc71e0547112eb432f0a36fb1924c4a738cb49';

  it('is a 40-character hex digest', () => {
    expect(createStableId({ a: 1 })).toMatch(/^[0-9a-f]{40}$/);
  });

  it('does not depend on the order of an object’s keys, at any depth', () => {
    const one = { a: 1, b: { c: 2, d: [{ x: 1, y: 2 }] } };
    const other = { b: { d: [{ y: 2, x: 1 }], c: 2 }, a: 1 };

    expect(createStableId(one)).toBe(createStableId(other));
  });

  it('keeps the order of array items, which is meaningful', () => {
    expect(createStableId([1, 2])).not.toBe(createStableId([2, 1]));
  });

  it('tells different values apart', () => {
    expect(createStableId({ a: 1 })).not.toBe(createStableId({ a: 2 }));
    expect(createStableId(null)).not.toBe(createStableId({}));
  });

  it('hashes the key-sorted JSON text', () => {
    expect(createStableId({ b: 2, a: 1 })).toBe(SHA1_OF_A1_B2);
  });
});
