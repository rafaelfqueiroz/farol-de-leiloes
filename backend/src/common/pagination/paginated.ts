// AR-35: the one envelope every list endpoint answers with, and the arithmetic services share.
// Framework-free, so a service takes a PageRequest without depending on the HTTP DTO.

/** A validated page request: `page` ≥ 1, `pageSize` 1..100 (PaginationQueryDto). */
export interface PageRequest {
  page: number;
  pageSize: number;
}

/** `{ items, total, page, pageSize }`: `total` counts every match, not just this page. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Documents to skip before the requested page: page 3 of 20 skips (3 - 1) × 20 = 40. */
export function skipOf({ page, pageSize }: PageRequest): number {
  return (page - 1) * pageSize;
}

export function paginated<T>(items: T[], total: number, request: PageRequest): Paginated<T> {
  return { items, total, page: request.page, pageSize: request.pageSize };
}

/** The same page with each item mapped, e.g. a service result to its response DTOs (AR-36). */
export function mapPage<T, R>(page: Paginated<T>, map: (item: T) => R): Paginated<R> {
  return { ...page, items: page.items.map(map) };
}

/** A page cut from a list already in memory, in its order. */
export function pageOfList<T>(all: T[], request: PageRequest): Paginated<T> {
  const skip = skipOf(request);
  return paginated(all.slice(skip, skip + request.pageSize), all.length, request);
}
