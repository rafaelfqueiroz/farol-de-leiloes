// AR-35: list endpoints answer `{ items, total, page, pageSize }`; `page` starts at 1 and `pageSize`
// is at most 100. This is the one place the browser knows that shape.
import { readApiError } from '@/lib/api-error';

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const MAX_PAGE_SIZE = 100;

/** The number of pages a list of `total` items has at `pageSize` per page (never below 1). */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** The walk was abandoned because the caller no longer wants the answer; it is never a result. */
export class PaginationCancelledError extends Error {
  constructor() {
    super('pagination cancelled');
    this.name = 'PaginationCancelledError';
  }
}

/**
 * Reads every page of a list endpoint, `MAX_PAGE_SIZE` items at a time, until it holds `total`
 * items (AR-35). A list the whole UI needs at once (a user's reminders, saved filters) must be
 * complete: there is no page cap, because a silently truncated list hides items (the oldest-first
 * reminders would drop the later pending ones). The walk still ends if a page comes back empty (the
 * total shrank meanwhile), so a shifting `total` cannot loop forever.
 *
 * `isCurrent` lets the caller stop the walk once its answer is no longer wanted (an account change,
 * #42). That rejects with `PaginationCancelledError` rather than resolving with the pages read so
 * far, so a cancelled walk can never be taken for a complete list. Throws the `ApiError` of the
 * first page that fails.
 */
export async function fetchAllPages<T>(
  path: string,
  init: RequestInit,
  isCurrent: () => boolean = () => true,
): Promise<T[]> {
  const items: T[] = [];
  const separator = path.includes('?') ? '&' : '?';
  for (let page = 1; ; page++) {
    const response = await fetch(`${path}${separator}page=${page}&pageSize=${MAX_PAGE_SIZE}`, init);
    if (!response.ok) throw await readApiError(response);
    const body: Paginated<T> = await response.json();
    if (!isCurrent()) throw new PaginationCancelledError();
    items.push(...body.items);
    if (items.length >= body.total || body.items.length === 0) return items;
  }
}
