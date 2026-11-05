// AR-47, SC-15: Sentry captures request bodies, headers, cookies, query strings and the user by
// default; none of it may leave the app (SPEC-002 BR-002-28). These are pure functions so they can
// be proven in a unit test (TS-07); `sentry-options.ts` hangs them on `beforeSend` and
// `beforeBreadcrumb`. When in doubt, drop.
import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs';

/** A URL without its query string and fragment; anything unparseable is dropped, not guessed. */
export function stripQuery(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  // `user` is dropped entirely (SC-15).
  delete event.user;

  if (event.request) {
    // Keep only the method and the query-less URL. Data, cookies, headers and query_string go.
    const { method } = event.request;
    const url = stripQuery(event.request.url);
    event.request = {
      ...(method === undefined ? {} : { method }),
      ...(url === undefined ? {} : { url }),
    };
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.flatMap((crumb) => {
      const scrubbed = scrubBreadcrumb(crumb);
      return scrubbed ? [scrubbed] : [];
    });
  }

  return event;
}

const URL_KEYS = ['url', 'from', 'to'] as const;

/** Returns `null` to drop the breadcrumb. */
export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  // Console output is free text that can carry anything: drop it whole.
  if (crumb.category === 'console') return null;

  // Only the structural fields and the query-less URLs survive: bodies, headers and any other
  // payload in `data` are dropped.
  const data: Record<string, unknown> = {};
  for (const key of URL_KEYS) {
    const value = stripQuery(crumb.data?.[key]);
    if (value !== undefined) data[key] = value;
  }
  for (const key of ['method', 'status_code'] as const) {
    const value: unknown = crumb.data?.[key];
    if (typeof value === 'string' || typeof value === 'number') data[key] = value;
  }

  const { category, type, level, timestamp } = crumb;
  return {
    ...(category === undefined ? {} : { category }),
    ...(type === undefined ? {} : { type }),
    ...(level === undefined ? {} : { level }),
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(Object.keys(data).length === 0 ? {} : { data }),
    // `message` is free text, so it is never kept.
  };
}
