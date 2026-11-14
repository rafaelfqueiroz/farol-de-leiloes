// AR-47 / SC-15: an event full of personal-looking data leaves the scrubber with none of it.
// Every value below is generated and obviously fake (TS-27).
import { describe, expect, it } from 'vitest';
import type { Breadcrumb, ErrorEvent } from '@sentry/nestjs';
import { scrubBreadcrumb, scrubEvent, stripQuery } from './sentry-scrubber.js';

const PII = {
  email: 'ana.teste@example.test',
  name: 'Ana Teste',
  phone: '+55 11 90000-0000',
  cpf: '000.000.000-00',
  token: 'fake.jwt.token-value',
  cookie: 'session=fake-session-cookie',
  ip: '203.0.113.7',
  password: 'fake-password-123',
  userId: '64b7f0000000000000000001',
};

function anEventFullOfPii(): ErrorEvent {
  return {
    type: undefined,
    event_id: 'abc123',
    level: 'error',
    platform: 'node',
    message: `failed for ${PII.email}`,
    server_name: 'api-host-ana-teste.internal',
    transaction: `GET /api/auth/reset?token=${PII.token}&email=${PII.email}`,
    contexts: {
      runtime: { name: 'node', version: 'v24.22.2' },
      os: { name: 'Linux', version: '6.1', kernel_version: '6.1.0', build: PII.name },
      app: { app_start_time: '2026-01-15T00:00:00Z', app_memory: 1024, app_name: PII.name },
      device: {
        arch: 'x64',
        processor_count: 4,
        device_name: PII.name,
        cpu_description: PII.email,
      },
      trace: {
        trace_id: 'a'.repeat(32),
        span_id: 'b'.repeat(16),
        parent_span_id: 'c'.repeat(16),
        data: { 'url.query': `email=${PII.email}` },
        op: 'http.server',
      },
      response: { status_code: 500, headers: { 'set-cookie': PII.cookie } },
      culture: { locale: 'pt-BR', timezone: 'America/Sao_Paulo' },
      customer: { email: PII.email, cpf: PII.cpf },
    },
    logentry: { message: `user ${PII.name}`, params: [PII.phone] },
    request: {
      method: 'POST',
      url: `https://api.example.test/api/auth/login?email=${PII.email}&token=${PII.token}#x`,
      query_string: `email=${PII.email}`,
      headers: {
        authorization: `Bearer ${PII.token}`,
        cookie: PII.cookie,
        'x-forwarded-for': PII.ip,
      },
      cookies: { session: PII.cookie },
      data: { email: PII.email, password: PII.password, cpf: PII.cpf },
      env: { REMOTE_ADDR: PII.ip },
    },
    user: { id: PII.userId, email: PII.email, username: PII.name, ip_address: PII.ip },
    tags: { method: 'POST', route: '/api/auth/login', email: PII.email },
    extra: { body: { phone: PII.phone } },
    exception: {
      values: [
        {
          type: 'MongoServerError',
          value: `E11000 duplicate key error: { email: "${PII.email}" }`,
          mechanism: {
            type: 'auto.middleware.express',
            handled: false,
            data: { function: 'handler', arg: `${PII.email} ${PII.phone}` },
          },
          stacktrace: {
            frames: [
              {
                filename: 'users.service.ts',
                function: 'create',
                lineno: 10,
                vars: { email: PII.email, cpf: PII.cpf },
              },
            ],
          },
        },
      ],
    },
    breadcrumbs: [
      {
        type: 'http',
        category: 'http',
        level: 'info',
        timestamp: 1,
        data: {
          method: 'GET',
          status_code: 200,
          url: `https://caixa.example.test/lista?cpf=${PII.cpf}`,
          'http.query': `cpf=${PII.cpf}`,
          'http.fragment': PII.phone,
          body: { email: PII.email },
        },
      },
      { category: 'console', level: 'log', message: `console: ${PII.email}` },
      { category: 'auth', message: `signed in ${PII.name}`, data: { email: PII.email } },
    ],
  };
}

describe('scrubEvent (AR-47)', () => {
  it('leaves none of the personal data of an event', () => {
    const json = JSON.stringify(scrubEvent(anEventFullOfPii()));

    for (const value of [
      ...Object.values(PII),
      encodeURIComponent(PII.email),
      'email=',
      'api-host',
    ]) {
      expect(json).not.toContain(value);
    }
  });

  it('keeps what locates the fault: method, path, route tags, exception type and frames', () => {
    const scrubbed = scrubEvent(anEventFullOfPii());

    expect(scrubbed.request).toEqual({
      method: 'POST',
      url: 'https://api.example.test/api/auth/login',
    });
    expect(scrubbed.tags).toEqual({ method: 'POST', route: '/api/auth/login' });
    expect(scrubbed.exception?.values?.[0]).toEqual({
      type: 'MongoServerError',
      mechanism: { type: 'auto.middleware.express', handled: false },
      stacktrace: { frames: [{ filename: 'users.service.ts', function: 'create', lineno: 10 }] },
    });
    expect(scrubbed).toMatchObject({ event_id: 'abc123', level: 'error', platform: 'node' });
    for (const field of ['user', 'extra', 'message', 'logentry', 'server_name'] as const) {
      expect(scrubbed[field]).toBeUndefined();
    }
  });

  it('keeps only the safe contexts, and only their safe keys', () => {
    expect(scrubEvent(anEventFullOfPii()).contexts).toEqual({
      runtime: { name: 'node', version: 'v24.22.2' },
      os: { name: 'Linux', version: '6.1', kernel_version: '6.1.0' },
      app: { app_start_time: '2026-01-15T00:00:00Z', app_memory: 1024 },
      device: { arch: 'x64', processor_count: 4 },
      trace: { trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16), parent_span_id: 'c'.repeat(16) },
    });
  });

  it('skips an empty context entry', () => {
    const event = { type: undefined, contexts: { runtime: null, os: { name: 'Linux' } } };
    expect(scrubEvent(event as unknown as ErrorEvent).contexts).toEqual({ os: { name: 'Linux' } });
  });

  it('names the transaction after the route pattern, never the URL', () => {
    // The tagged method and route: GET was not tagged in the PII event, POST was.
    expect(scrubEvent(anEventFullOfPii()).transaction).toBe('POST /api/auth/login');
    expect(
      scrubEvent({
        type: undefined,
        transaction: '/api/x?email=a',
        tags: { route: '/api/x' },
      } as ErrorEvent).transaction,
    ).toBe('/api/x');
  });

  it('drops a transaction it cannot name after a route (a job, an untagged event)', () => {
    const job = scrubEvent({
      type: undefined,
      transaction: `/api/x?email=${PII.email}`,
      tags: { jobName: 'auctions-import' },
    } as ErrorEvent);
    expect(job.transaction).toBeUndefined();
    expect(job.tags).toEqual({ jobName: 'auctions-import' });
    expect(
      scrubEvent({ type: undefined, transaction: `/api/x?email=${PII.email}` } as ErrorEvent),
    ).not.toHaveProperty('transaction');
  });

  it('keeps a mechanism type without a handled flag it never had', () => {
    const event = scrubEvent({
      type: undefined,
      exception: {
        values: [{ type: 'Error', mechanism: { type: 'generic', data: { x: PII.email } } }],
      },
    } as unknown as ErrorEvent);
    expect(event.exception?.values?.[0]?.mechanism).toEqual({ type: 'generic' });
  });

  it('scrubs the breadcrumbs carried by the event too', () => {
    expect(scrubEvent(anEventFullOfPii()).breadcrumbs).toEqual([
      {
        type: 'http',
        category: 'http',
        level: 'info',
        timestamp: 1,
        data: { method: 'GET', status_code: 200, url: 'https://caixa.example.test/lista' },
      },
      { category: 'auth' },
    ]);
  });

  it('keeps a user reduced to its hashed id (AR-46), and nothing else of it', () => {
    const event = scrubEvent({
      type: undefined,
      user: { id: '0123456789abcdef', email: PII.email },
    } as ErrorEvent);
    expect(event.user).toEqual({ id: '0123456789abcdef' });
  });

  it('handles a minimal event: nothing to scrub, nothing added', () => {
    expect(scrubEvent({ type: undefined, event_id: 'e1' } as ErrorEvent)).toEqual({
      type: undefined,
      event_id: 'e1',
    });
    expect(
      scrubEvent({
        type: undefined,
        request: {},
        exception: { values: [{ type: 'Error' }] },
        user: { id: 42 },
      } as unknown as ErrorEvent),
    ).toEqual({ type: undefined, request: {}, exception: { values: [{ type: 'Error' }] } });
    expect(scrubEvent({ type: undefined, exception: {} } as ErrorEvent).exception).toEqual({
      values: undefined,
    });
    expect(
      scrubEvent({
        type: undefined,
        exception: { values: [{ type: 'Error', stacktrace: {} }] },
      } as ErrorEvent).exception?.values?.[0],
    ).toEqual({ type: 'Error', stacktrace: { frames: undefined } });
  });
});

describe('scrubBreadcrumb (AR-47)', () => {
  it('drops console breadcrumbs', () => {
    expect(scrubBreadcrumb({ category: 'console', message: PII.email })).toBeNull();
  });

  it('keeps an HTTP breadcrumb method, status and URL without its query string', () => {
    const crumb: Breadcrumb = {
      category: 'http',
      data: {
        method: 'POST',
        status_code: 500,
        url: `https://api.stripe.test/v1/x?email=${PII.email}`,
        body: PII.email,
      },
    };
    expect(scrubBreadcrumb(crumb)).toEqual({
      category: 'http',
      data: { method: 'POST', status_code: 500, url: 'https://api.stripe.test/v1/x' },
    });
  });

  it('keeps no data of an HTTP breadcrumb that has none, or none of the expected types', () => {
    expect(scrubBreadcrumb({ type: 'http' })).toEqual({ type: 'http', data: {} });
    expect(
      scrubBreadcrumb({ type: 'http', data: { method: 1, status_code: '200', url: {} } }),
    ).toEqual({ type: 'http', data: {} });
  });

  it('keeps only the category and level of any other breadcrumb', () => {
    expect(
      scrubBreadcrumb({
        category: 'query',
        level: 'debug',
        message: PII.cpf,
        data: { cpf: PII.cpf },
      }),
    ).toEqual({ category: 'query', level: 'debug' });
    expect(scrubBreadcrumb({ message: PII.email })).toEqual({});
  });
});

describe('stripQuery', () => {
  it.each([
    ['https://h.test/a?b=1', 'https://h.test/a'],
    ['https://h.test/a#frag', 'https://h.test/a'],
    ['/api/x?email=a@b.test', '/api/x'],
    ['https://user:fake-pass@h.test/a', 'https://h.test/a'],
    ['?only=query', ''],
    ['https://h.test/plain', 'https://h.test/plain'],
  ])('%s → %s', (url, expected) => {
    expect(stripQuery(url)).toBe(expected);
  });
});
