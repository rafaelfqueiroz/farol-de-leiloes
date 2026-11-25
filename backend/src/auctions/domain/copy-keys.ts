// SPEC-004 BR-004-22, BR-004-30, SC-18: where the copies of a property's files live in R2. A key
// carries the property number, the kind and a prefix of the content hash: it never carries
// anything personal, and two different contents never share a key, so a new version never
// overwrites the previous one. Pure (AR-05).
import type { CopyKind } from './file-validation.js';

/** SC-18: files under this prefix live only in the private bucket (never the public one). */
export const PRIVATE_COPY_PREFIX = 'private/';

/** A Caixa property number is digits (and sometimes a dash); anything else gets no key. */
export function isSafePropertyCode(code: string): boolean {
  return /^[A-Za-z0-9-]{1,40}$/.test(code);
}

/** The part of a SHA-256 (hex) a key and a change entry carry. */
export function hashPrefix(hash: string): string {
  return hash.slice(0, 16);
}

/**
 * `auctions/{code}/photos/{hash}.jpg`, `auctions/{code}/edital/{hash}.pdf` (public catalogue files),
 * `private/auctions/{code}/matricula/{hash}.pdf` (SC-18: the matrícula names people, so it is kept
 * in the private bucket and linked per request). Null when the code is not safe to put in a key.
 */
export function copyKey(
  kind: CopyKind,
  code: string,
  hash: string,
  extension: string,
): string | null {
  if (!isSafePropertyCode(code)) return null;
  const name = `${hashPrefix(hash)}.${extension}`;
  switch (kind) {
    case 'PHOTO':
      return `auctions/${code}/photos/${name}`;
    case 'EDITAL':
      return `auctions/${code}/edital/${name}`;
    case 'MATRICULA':
      return `${PRIVATE_COPY_PREFIX}auctions/${code}/matricula/${name}`;
  }
}

/** Whether the copies of this kind are kept in the private bucket. */
export function isPrivateCopy(kind: CopyKind): boolean {
  return kind === 'MATRICULA';
}
