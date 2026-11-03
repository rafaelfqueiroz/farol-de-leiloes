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

// A list the whole UI needs at once (a user's reminders, saved filters) is read page by page
// instead of in one unbounded request; this caps the walk so a runaway `total` cannot loop.
const MAX_PAGES = 20;

/**
 * Reads every page of a list endpoint, `MAX_PAGE_SIZE` items at a time (AR-35). `isCurrent` lets
 * the caller stop the walk once its answer is no longer wanted (an account change, #42).
 * Throws the `ApiError` of the first page that fails.
 */
export async function fetchAllPages<T>(
  path: string,
  init: RequestInit,
  isCurrent: () => boolean = () => true,
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const separator = path.includes('?') ? '&' : '?';
    const response = await fetch(`${path}${separator}page=${page}&pageSize=${MAX_PAGE_SIZE}`, init);
    if (!response.ok) throw await readApiError(response);
    const body: Paginated<T> = await response.json();
    items.push(...body.items);
    if (items.length >= body.total || body.items.length === 0 || !isCurrent()) break;
  }
  return items;
}
