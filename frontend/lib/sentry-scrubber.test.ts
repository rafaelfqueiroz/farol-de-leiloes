// AR-47, SC-15, TS-07: nothing personal survives the scrubber. Every value below is fake (TS-27).
import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs';
import { describe, expect, it } from 'vitest';
import { scrubBreadcrumb, scrubEvent, stripQuery } from './sentry-scrubber';
import { sentryOptions } from './sentry-options';

const FAKE = [
  'fake.person@example.test',
  '000.000.000-00',
  'fake-session-token',
  'fake-body-secret',
  'fake-query-value',
  'fake-console-text',
  'fake-header-value',
  'fake-user-id',
];

function pii(): ErrorEvent {
  return {
    type: undefined,
    message: 'handled',
    user: { id: 'fake-user-id', email: 'fake.person@example.test', ip_address: '203.0.113.9' },
    request: {
      method: 'POST',
      url: 'https://site.test/api/auth/login?email=fake.person@example.test&q=fake-query-value#frag',
      query_string: 'email=fake.person@example.test',
      cookies: { session: 'fake-session-token' },
      headers: { authorization: 'Bearer fake-header-value' },
      data: { cpf: '000.000.000-00', note: 'fake-body-secret' },
    },
    breadcrumbs: [
      { category: 'console', message: 'fake-console-text fake.person@example.test' },
      {
        category: 'fetch',
        type: 'http',
        level: 'info',
        timestamp: 1,
        message: 'fake-body-secret',
        data: {
          url: '/api/x?token=fake-session-token',
          method: 'GET',
          status_code: 200,
          request_body: 'fake-body-secret',
          response_body: '000.000.000-00',
          reason: 'fake-header-value',
        },
      },
      {
        category: 'navigation',
        data: { from: '/a?email=fake.person@example.test', to: '/b?q=fake-query-value#x' },
      },
      { category: 'ui.click', message: 'div > button' },
    ],
  };
}

describe('scrubEvent', () => {
  it('leaves none of the fake personal data anywhere in the event', () => {
    const json = JSON.stringify(scrubEvent(pii()));
    for (const value of FAKE) expect(json).not.toContain(value);
  });

  it('drops the user, the request body, cookies, headers and query string', () => {
    const event = scrubEvent(pii());
    expect(event.user).toBeUndefined();
    expect(event.request).toEqual({ method: 'POST', url: 'https://site.test/api/auth/login' });
  });

  it('drops console breadcrumbs and keeps only structural fields of the others', () => {
    const crumbs = scrubEvent(pii()).breadcrumbs;
    expect(crumbs).toEqual([
      {
        category: 'fetch',
        type: 'http',
        level: 'info',
        timestamp: 1,
        data: { url: '/api/x', method: 'GET', status_code: 200 },
      },
      { category: 'navigation', data: { from: '/a', to: '/b' } },
      { category: 'ui.click' },
    ]);
  });

  it('handles an event with no request, user or breadcrumbs', () => {
    expect(scrubEvent({ type: undefined, message: 'x' })).toEqual({
      type: undefined,
      message: 'x',
    });
  });

  it('handles a request with no method or url', () => {
    expect(scrubEvent({ type: undefined, request: { data: 'fake-body-secret' } }).request).toEqual(
      {},
    );
  });
});

describe('scrubBreadcrumb', () => {
  it('drops console breadcrumbs', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'fake-console-text' })).toBeNull();
  });

  it('keeps a bare breadcrumb bare', () => {
    expect(scrubBreadcrumb({} as Breadcrumb)).toEqual({});
  });

  it('ignores non-string urls and non-scalar methods or statuses', () => {
    const crumb = { data: { url: 42, method: { a: 1 }, status_code: 'bad' } } as Breadcrumb;
    expect(scrubBreadcrumb(crumb)).toEqual({ data: { status_code: 'bad' } });
  });
});

describe('stripQuery', () => {
  it('cuts the query and the fragment', () => {
    expect(stripQuery('/a?b=1')).toBe('/a');
    expect(stripQuery('/a#frag')).toBe('/a');
    expect(stripQuery('/a')).toBe('/a');
  });

  it('drops anything that is not a string', () => {
    expect(stripQuery(undefined)).toBeUndefined();
    expect(stripQuery(1)).toBeUndefined();
  });
});

describe('sentryOptions', () => {
  it('is inert without a DSN and under test, and never sends PII or traces', () => {
    const options = sentryOptions(undefined);
    expect(options.enabled).toBe(false);
    expect(sentryOptions('https://key@o0.ingest.sentry.io/1').enabled).toBe(false); // NODE_ENV=test
    expect(options.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
    });
    expect(options.tracesSampleRate).toBe(0);
  });

  it('wires the scrubbers', () => {
    const options = sentryOptions(undefined);
    expect(options.beforeSend(pii()).user).toBeUndefined();
    expect(options.beforeBreadcrumb({ category: 'console' })).toBeNull();
  });
});
