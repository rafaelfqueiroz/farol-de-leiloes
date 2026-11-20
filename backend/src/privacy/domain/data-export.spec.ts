// SPEC-010 BR-010-11: the export's expiry window and what its owner may do at each instant. The
// expectations are hand-computed (TS-04): 7 days = 7 x 24 h = 168 h = 604 800 000 ms.
import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  type ExportStatus,
  downloadVerdict,
  exportExpiresAt,
  isDueForExpiry,
  isExportExpired,
  isLiveExport,
} from './data-export.js';

const READY = new Date('2026-03-10T15:00:00.000Z');
// 10 March 15:00 + 7 days = 17 March 15:00 (no zone is involved: 24-hour days).
const EXPIRES = new Date('2026-03-17T15:00:00.000Z');
const minutes = (n: number) => n * 60 * 1000;

describe('BR-010-11: the export lives 7 days from the moment it is ready', () => {
  it('adds the configured days of 24 hours', () => {
    expect(DAY_MS).toBe(86_400_000);
    expect(exportExpiresAt(READY, 7)).toEqual(EXPIRES);
    // 10 March 15:00 + 3 days = 13 March 15:00
    expect(exportExpiresAt(READY, 3)).toEqual(new Date('2026-03-13T15:00:00.000Z'));
  });

  it('is half-open: still valid a minute before, over at the very instant and after', () => {
    expect(isExportExpired(EXPIRES, new Date(EXPIRES.getTime() - minutes(1)))).toBe(false);
    expect(isExportExpired(EXPIRES, EXPIRES)).toBe(true);
    expect(isExportExpired(EXPIRES, new Date(EXPIRES.getTime() + minutes(1)))).toBe(true);
  });

  it('6 days 23 hours after it was ready is valid; 7 days and 1 minute is refused', () => {
    // 6 d 23 h = 6 x 24 + 23 = 167 h
    expect(isExportExpired(EXPIRES, new Date(READY.getTime() + 167 * 60 * minutes(1)))).toBe(false);
    // 7 d 1 min = 168 h + 1 min
    expect(
      isExportExpired(EXPIRES, new Date(READY.getTime() + 168 * 60 * minutes(1) + minutes(1))),
    ).toBe(true);
  });
});

describe('BR-010-11: what the owner gets when asking for the file', () => {
  const before = new Date(EXPIRES.getTime() - 1);
  it.each<[string, { status: ExportStatus; expiresAt?: Date | null }, Date, string]>([
    ['a ready export inside its window', { status: 'ready', expiresAt: EXPIRES }, before, 'ok'],
    [
      'a ready export at its expiry instant',
      { status: 'ready', expiresAt: EXPIRES },
      EXPIRES,
      'expired',
    ],
    ['a ready export without an expiry never gets a link', { status: 'ready' }, before, 'expired'],
    [
      'a ready export with a null expiry never gets a link',
      { status: 'ready', expiresAt: null },
      before,
      'expired',
    ],
    ['one already marked expired', { status: 'expired', expiresAt: EXPIRES }, before, 'expired'],
    ['a queued export is not there yet', { status: 'queued' }, before, 'not_ready'],
    ['a failed export has no file', { status: 'failed' }, before, 'unavailable'],
    ['a cancelled export has no file', { status: 'cancelled' }, before, 'unavailable'],
  ])('%s', (_label, stored, now, verdict) => {
    expect(downloadVerdict(stored, now)).toBe(verdict);
  });
});

describe('BR-010-11: which exports the expiry job picks up', () => {
  it.each<[string, { status: ExportStatus; expiresAt?: Date | null }, boolean]>([
    ['ready and past its expiry', { status: 'ready', expiresAt: EXPIRES }, true],
    [
      'ready and still valid',
      { status: 'ready', expiresAt: new Date(EXPIRES.getTime() + 1) },
      false,
    ],
    ['ready without an expiry (never due: it needs a human)', { status: 'ready' }, false],
    ['queued', { status: 'queued', expiresAt: EXPIRES }, false],
    ['already expired', { status: 'expired', expiresAt: EXPIRES }, false],
  ])('%s', (_label, stored, expected) => {
    expect(isDueForExpiry(stored, EXPIRES)).toBe(expected);
  });
});

describe('BR-010-11: one live export per account', () => {
  it.each<[ExportStatus, boolean]>([
    ['queued', true],
    ['ready', true],
    ['failed', false],
    ['cancelled', false],
    ['expired', false],
  ])('%s is live: %s', (status, live) => {
    expect(isLiveExport(status)).toBe(live);
  });
});
