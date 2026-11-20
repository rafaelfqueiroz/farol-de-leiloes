// SPEC-010 BR-010-08, BR-010-11: the life of one data export. Pure (AR-05): the time comes in as an
// argument, never from a clock. `DataExportService` and the two jobs apply it.

export const EXPORT_STATUSES = ['queued', 'ready', 'failed', 'cancelled', 'expired'] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

/** BR-010-11: one live export per account, and these are the live ones. */
export const LIVE_EXPORT_STATUSES: readonly ExportStatus[] = ['queued', 'ready'];

/**
 * Why an export failed, stored on the row (`errorCode`): stable codes, never a message (SC-15).
 * `EXPORT_STORAGE_UNAVAILABLE`: R2_PRIVATE_BUCKET is not configured (an export never falls back to
 * the public bucket, SC-18) or the upload failed; `EXPORT_BUILD_FAILED`: any other fault while
 * collecting or writing the file; `EXPORT_ACCOUNT_NOT_ACTIVE`: the account was no longer active
 * when the worker got to it (closed or deactivated).
 */
export const EXPORT_ERROR_CODES = [
  'EXPORT_STORAGE_UNAVAILABLE',
  'EXPORT_BUILD_FAILED',
  'EXPORT_ACCOUNT_NOT_ACTIVE',
] as const;
export type ExportErrorCode = (typeof EXPORT_ERROR_CODES)[number];

export const DAY_MS = 24 * 60 * 60 * 1000;

export function isLiveExport(status: ExportStatus): boolean {
  return LIVE_EXPORT_STATUSES.includes(status);
}

/** BR-010-11: an export stays downloadable `ttlDays` of 24 hours after it became ready. */
export function exportExpiresAt(readyAt: Date, ttlDays: number): Date {
  return new Date(readyAt.getTime() + ttlDays * DAY_MS);
}

/**
 * The window is half-open, `[readyAt, expiresAt)`: at `expiresAt` itself the export is already
 * expired, and so is everything after it (7 days and 1 minute is refused, BR-010-11).
 */
export function isExportExpired(expiresAt: Date, now: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}

export type DownloadVerdict = 'ok' | 'not_ready' | 'expired' | 'unavailable';

/**
 * What the owner of an export gets when asking for its file: a link (`ok`), a wait (`not_ready`,
 * still queued), the end of its life (`expired`: past `expiresAt`, or already marked so) or
 * nothing to download (`unavailable`: it failed or was cancelled, there is no file).
 */
export function downloadVerdict(
  stored: { status: ExportStatus; expiresAt?: Date | null },
  now: Date,
): DownloadVerdict {
  switch (stored.status) {
    case 'queued':
      return 'not_ready';
    case 'ready':
      return stored.expiresAt && !isExportExpired(stored.expiresAt, now) ? 'ok' : 'expired';
    case 'expired':
      return 'expired';
    case 'failed':
    case 'cancelled':
      return 'unavailable';
  }
}

/** The expiry job's question: a ready export whose time ran out is deleted and marked expired. */
export function isDueForExpiry(
  stored: { status: ExportStatus; expiresAt?: Date | null },
  now: Date,
): boolean {
  return stored.status === 'ready' && !!stored.expiresAt && isExportExpired(stored.expiresAt, now);
}
