// AR-47 / SC-15: what reaches Sentry is the error's class, its stack and where it happened —
// never what the user sent. Sentry attaches request bodies, headers, cookies, query strings and
// the user by default; `dataCollection` (sentry-options.ts) turns some of that off and this
// scrubber removes the rest, as `beforeSend` and `beforeBreadcrumb` (sentry-options.ts). Pure functions over
// Sentry's event shapes, so the scrubbing is proven by a unit test.
import type { Breadcrumb, Event } from '@sentry/nestjs';
import { USER_HASH_LENGTH } from './user-hash';

const USER_HASH = new RegExp(`^[0-9a-f]{${USER_HASH_LENGTH}}$`);

/**
 * Tags the API sets on a captured fault: method and route (api-exception.filter.ts), jobName (the
 * import and scraper failures). Every other tag is dropped.
 */
export const ALLOWED_TAGS = ['method', 'route', 'jobName'] as const;

/**
 * The contexts kept, and the keys kept in each: the runtime and machine basics (versions, memory,
 * CPU) and the trace ids. Every other context goes (custom ones, `response`, `culture`,
 * `cloud_resource`), and so does every other key of a kept one (a trace's `data`, a device name).
 */
export const ALLOWED_CONTEXTS: Readonly<Record<string, readonly string[]>> = {
  runtime: ['name', 'version'],
  os: ['name', 'version', 'kernel_version'],
  app: ['app_start_time', 'app_memory'],
  device: ['arch', 'boot_time', 'memory_size', 'free_memory', 'processor_count'],
  trace: ['trace_id', 'span_id', 'parent_span_id'],
};

/** A URL without its query string, fragment or credentials. */
export function stripQuery(url: string): string {
  const [withoutQuery = ''] = url.split(/[?#]/, 1);
  return withoutQuery.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1');
}

function scrubRequest(request: NonNullable<Event['request']>): Event['request'] {
  return {
    ...(request.method === undefined ? {} : { method: request.method }),
    ...(request.url === undefined ? {} : { url: stripQuery(request.url) }),
  };
}

/** At most the hashed id (AR-46); an email, a name, an address or a raw id never survive. */
function scrubUser(user: NonNullable<Event['user']>): Event['user'] {
  const id = user.id;
  return typeof id === 'string' && USER_HASH.test(id) ? { id } : undefined;
}

function scrubTags(tags: NonNullable<Event['tags']>): Event['tags'] {
  return Object.fromEntries(
    Object.entries(tags).filter(([key]) => (ALLOWED_TAGS as readonly string[]).includes(key)),
  );
}

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => keys.includes(key)));
}

function scrubContexts(contexts: NonNullable<Event['contexts']>): Event['contexts'] {
  return Object.fromEntries(
    Object.entries(contexts).flatMap(([name, context]) => {
      const keys = ALLOWED_CONTEXTS[name];
      return keys && context ? [[name, pick(context, keys)]] : [];
    }),
  ) as Event['contexts'];
}

/**
 * The transaction is the route pattern the filter tagged (`GET /api/auctions/:code`), or nothing:
 * Sentry may name it after the URL, query string included.
 */
function transactionOf(tags: Event['tags']): string | undefined {
  const route = tags?.route;
  if (typeof route !== 'string') return undefined;
  const method = tags?.method;
  return typeof method === 'string' ? `${method} ${route}` : route;
}

/**
 * The exception's type and stack frames stay; its message goes: a driver error quotes the value
 * it failed on (a duplicate-key error names the email). Frame variables go too.
 */
function scrubException(exception: NonNullable<Event['exception']>): Event['exception'] {
  return {
    values: exception.values?.map((value) => {
      const scrubbed = { ...value };
      delete scrubbed.value;
      // A mechanism keeps how it was caught; its `data` may carry the handler's arguments.
      if (scrubbed.mechanism) {
        const { type, handled } = scrubbed.mechanism;
        scrubbed.mechanism = { type, ...(handled === undefined ? {} : { handled }) };
      }
      if (scrubbed.stacktrace) {
        scrubbed.stacktrace = {
          ...scrubbed.stacktrace,
          frames: scrubbed.stacktrace.frames?.map((frame) => {
            const kept = { ...frame };
            delete kept.vars;
            return kept;
          }),
        };
      }
      return scrubbed;
    }),
  };
}

/** Free-form fields a library or a `captureMessage` may fill with anything. */
const FREE_FORM_FIELDS = ['extra', 'message', 'logentry'] as const;

/** `beforeSend`: the event with everything personal removed (it never drops an event). */
export function scrubEvent<T extends Event>(event: T): T {
  const scrubbed: Event = { ...event };
  for (const field of FREE_FORM_FIELDS) delete scrubbed[field];
  delete scrubbed.user;
  // The host name says nothing about the fault; the runtime contexts that stay say enough.
  delete scrubbed.server_name;
  delete scrubbed.transaction;
  const { request, user, tags, exception, breadcrumbs, contexts } = event;
  const transaction = transactionOf(tags);
  if (transaction !== undefined) scrubbed.transaction = transaction;
  if (contexts) scrubbed.contexts = scrubContexts(contexts);
  if (request) scrubbed.request = scrubRequest(request);
  const scrubbedUser = user && scrubUser(user);
  if (scrubbedUser) scrubbed.user = scrubbedUser;
  if (tags) scrubbed.tags = scrubTags(tags);
  if (exception) scrubbed.exception = scrubException(exception);
  if (breadcrumbs) {
    scrubbed.breadcrumbs = breadcrumbs.flatMap((crumb) => scrubBreadcrumb(crumb) ?? []);
  }
  return scrubbed as T;
}

/**
 * `beforeBreadcrumb`: an HTTP breadcrumb keeps its method, status and URL without the query
 * string, and nothing else of its data. Console breadcrumbs are dropped (a library's console
 * output may hold anything); every other breadcrumb keeps its category and level only.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === 'console') return null;
  const { type, category, level, timestamp } = breadcrumb;
  const base: Breadcrumb = {
    ...(type === undefined ? {} : { type }),
    ...(category === undefined ? {} : { category }),
    ...(level === undefined ? {} : { level }),
    ...(timestamp === undefined ? {} : { timestamp }),
  };
  if (type !== 'http' && category !== 'http') return base;
  const data = breadcrumb.data ?? {};
  const { method, status_code: statusCode, url } = data as Record<string, unknown>;
  return {
    ...base,
    data: {
      ...(typeof method === 'string' ? { method } : {}),
      ...(typeof statusCode === 'number' ? { status_code: statusCode } : {}),
      ...(typeof url === 'string' ? { url: stripQuery(url) } : {}),
    },
  };
}
