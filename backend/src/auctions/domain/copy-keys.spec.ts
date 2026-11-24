import { describe, expect, it } from 'vitest';
import { copyKey, hashPrefix, isPrivateCopy, isSafePropertyCode } from './copy-keys.js';

const HASH = 'abcdef0123456789ffffffffffffffffffffffffffffffffffffffffffffffff';

describe('copyKey (BR-004-22, BR-004-30, SC-18)', () => {
  it('puts photos and the edital in the public catalogue, under the property, by content', () => {
    expect(copyKey('PHOTO', '8787708003668', HASH, 'jpg')).toBe(
      'auctions/8787708003668/photos/abcdef0123456789.jpg',
    );
    expect(copyKey('EDITAL', '8787708003668', HASH, 'pdf')).toBe(
      'auctions/8787708003668/edital/abcdef0123456789.pdf',
    );
  });

  it('puts the matrícula under the private prefix (SC-18)', () => {
    expect(copyKey('MATRICULA', '8787708003668', HASH, 'pdf')).toBe(
      'private/auctions/8787708003668/matricula/abcdef0123456789.pdf',
    );
  });

  it('gives two contents two keys, so a new version never overwrites the previous one', () => {
    const other = '0123456789abcdef' + HASH.slice(16);
    expect(copyKey('EDITAL', '1', HASH, 'pdf')).not.toBe(copyKey('EDITAL', '1', other, 'pdf'));
  });

  it('gives no key to a code that could climb out of its folder', () => {
    for (const code of ['', '../x', 'a/b', 'a b', 'x'.repeat(41), '12%2e']) {
      expect(isSafePropertyCode(code)).toBe(false);
      expect(copyKey('PHOTO', code, HASH, 'jpg')).toBeNull();
    }
    expect(isSafePropertyCode('8787708003668')).toBe(true);
    expect(isSafePropertyCode('1444-2')).toBe(true);
  });

  it('keeps the first 16 characters of the hash', () => {
    expect(hashPrefix(HASH)).toBe('abcdef0123456789');
  });

  it('says that only the matrícula is private', () => {
    expect(isPrivateCopy('MATRICULA')).toBe(true);
    expect(isPrivateCopy('EDITAL')).toBe(false);
    expect(isPrivateCopy('PHOTO')).toBe(false);
  });
});
