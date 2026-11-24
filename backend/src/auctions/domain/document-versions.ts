// SPEC-004 BR-004-30, DL-004-10: the versions of a property's edital and matrícula. Append-only:
// when Caixa publishes another file the new one becomes the current version and the previous one
// stays stored, with its retrieval date and (where Caixa shows it) its publication date. Pure
// (AR-05): "now" is an argument (AR-24).
import { brasiliaCalendarDate } from '../../common/clock/brasilia-time.js';
import { addCalendarDays } from '../../common/domain/business-day.js';
import { type ChangeDraft } from './change-types.js';
import { hashPrefix } from './copy-keys.js';

export type DocumentKind = 'MATRICULA' | 'EDITAL';

/** What a stored version remembers for the decisions below. */
export interface VersionFacts {
  sourceUrl: string;
  contentHash: string;
  /** When the file was last compared with Caixa's (its retrieval, or a later re-check). */
  checkedAt: Date;
  publishedAt: Date | null;
}

/** How long a stored document is trusted before it is fetched again to compare its content. */
export const DOCUMENT_RECHECK_DAYS = 30;

/** What the page says of a document right now. */
export interface PageDocument {
  url: string | null;
  publishedAt: Date | null;
}

/**
 * Whether the document is worth a request this time. The page names no document: nothing to ask
 * for, whatever is stored stays. Otherwise: none stored, another address, another publication date,
 * or last compared with Caixa's DOCUMENT_RECHECK_DAYS or more days ago (a replaced file behind the same address and date is
 * found by its content hash then, BR-004-30).
 */
export function shouldFetchDocument(
  current: VersionFacts | null,
  page: PageDocument,
  now: Date,
): boolean {
  if (page.url === null) return false;
  if (current === null) return true;
  if (current.sourceUrl !== page.url) return true;
  if (page.publishedAt !== null && page.publishedAt.getTime() !== current.publishedAt?.getTime()) {
    return true;
  }
  const recheckAfter = addCalendarDays(
    brasiliaCalendarDate(current.checkedAt),
    DOCUMENT_RECHECK_DAYS,
  );
  return brasiliaCalendarDate(now) >= recheckAfter;
}

/**
 * BR-004-30: a fetched file is a NEW version when its source address or its content differs from the
 * current version's (or there is none yet). The same address and content again is no new version.
 */
export function isNewVersion(
  current: Pick<VersionFacts, 'sourceUrl' | 'contentHash'> | null,
  fetched: Pick<VersionFacts, 'sourceUrl' | 'contentHash'>,
): boolean {
  return (
    current === null ||
    current.sourceUrl !== fetched.sourceUrl ||
    current.contentHash !== fetched.contentHash
  );
}

/**
 * BR-004-30: the entry of a replaced document. Not one of the relevant types (BR-004-26): history
 * only, for SPEC-024. The first copy of a property is a collection, not a replacement (unknown to
 * known is not a change, BR-004-15), so it has no entry; nor has a new address for the same
 * content. The values are content hash prefixes.
 */
export function documentReplacedEntry(
  code: string,
  kind: DocumentKind,
  previous: Pick<VersionFacts, 'contentHash'> | null,
  next: Pick<VersionFacts, 'contentHash'>,
): ChangeDraft | null {
  if (previous === null || previous.contentHash === next.contentHash) return null;
  return {
    propertyCode: code,
    source: 'DETAILS',
    type: 'OTHER_FIELD',
    relevant: false,
    field: kind === 'EDITAL' ? 'edital' : 'matricula',
    oldValue: hashPrefix(previous.contentHash),
    newValue: hashPrefix(next.contentHash),
  };
}
