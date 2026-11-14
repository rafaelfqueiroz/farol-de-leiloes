// AR-45/AR-46/SC-15: the nestjs-pino setup over a real Nest + Express stack, with the app's own
// setup (configureApp) and the JSON lines captured in memory: nothing is printed (TESTING §2) and
// supertest binds an ephemeral loopback port in this process (TS-01, TS-07).
import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Controller, Get, type INestApplication, Logger, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Logger as PinoLogger, LoggerModule } from 'nestjs-pino';
import request from 'supertest';
import { configureApp } from '../../app.setup.js';
import { testConfigService } from '../../../test/support/test-env.js';
import { runInJobContext } from './job-context.js';
import { setLogUserHash } from './log-context.js';
import {
  loggerParams,
  logMethod,
  REDACT_PATHS,
  requestLogLevel,
  routeOf,
  serializeError,
  serializeRequest,
  serializeResponse,
  stackFrames,
} from './logger-options.js';
import { hashUserId } from './user-hash.js';

// Fake personal data that must never reach a log line (TS-27).
const EMAIL = 'ana.teste@example.test';
const TOKEN = 'Bearer fake.jwt.token-value';
const COOKIE = 'session=fake-session-cookie';
const USER_ID = '64b7f0000000000000000001';
const SECRET = 'test-log-hash-secret-not-a-real-one-000';

type Line = Record<string, unknown>;
const lines: Line[] = [];
const memory = new Writable({
  write(chunk: Buffer, _encoding, done) {
    for (const text of chunk.toString().split('\n').filter(Boolean)) {
      lines.push(JSON.parse(text) as Line);
    }
    done();
  },
});

@Controller('probe')
class ProbeController {
  private readonly logger = new Logger('Probe');

  @Get('log')
  log(): { ok: true } {
    this.logger.log('probe handled');
    return { ok: true };
  }

  @Get('user')
  user(): { ok: true } {
    setLogUserHash(hashUserId(SECRET, USER_ID));
    this.logger.log('signed-in probe');
    return { ok: true };
  }

  @Get('fail')
  fail(): never {
    throw new Error(`E11000 duplicate key error: { email: "${EMAIL}" }`);
  }
}

let healthStatus = 200;

@Controller('health')
class HealthProbeController {
  @Get()
  health(@Res({ passthrough: true }) res: Response): { status: string } {
    res.status(healthStatus);
    return { status: healthStatus === 200 ? 'ok' : 'down' };
  }
}

const completion = (route: string) =>
  lines.find(
    (line) =>
      (line.msg === 'request completed' || line.msg === 'request failed') && line.route === route,
  );

/** Every line of a request: the ones carrying its correlation id. */
const linesOf = (id: string) => lines.filter((line) => line.correlationId === id);

describe('nestjs-pino over HTTP (AR-45, AR-46)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const params = loggerParams('info');
    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule.forRoot({ ...params, pinoHttp: [params.pinoHttp as object, memory] })],
      controllers: [ProbeController, HealthProbeController],
      providers: [{ provide: ConfigService, useValue: testConfigService() }],
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(PinoLogger));
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    lines.length = 0;
    healthStatus = 200;
  });

  it('writes JSON lines that all carry the request id echoed as x-request-id', async () => {
    const response = await http().get('/api/probe/log').expect(200);
    const id = response.headers['x-request-id'] as string;

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const own = linesOf(id);
    expect(own.map((line) => line.msg)).toEqual(['probe handled', 'request completed']);
    expect(own[0]).toMatchObject({ level: 30, context: 'Probe', time: expect.any(String) });
  });

  it('logs method, route, status and response time; never headers, cookies, query or body', async () => {
    await http()
      .get(`/api/probe/log?email=${encodeURIComponent(EMAIL)}`)
      .set('Authorization', TOKEN)
      .set('Cookie', COOKIE)
      .set('x-request-id', 'bff-0123-abcd')
      .expect(200);

    const line = completion('/api/probe/log');
    expect(line).toMatchObject({
      correlationId: 'bff-0123-abcd',
      req: { method: 'GET' },
      route: '/api/probe/log',
      res: { statusCode: 200 },
      responseTime: expect.any(Number),
    });
    expect(Object.keys(line?.req as object)).toEqual(['method']);
    expect(Object.keys(line?.res as object)).toEqual(['statusCode']);
    const all = JSON.stringify(lines);
    for (const secret of [EMAIL, encodeURIComponent(EMAIL), 'fake.jwt', 'fake-session', 'email=']) {
      expect(all).not.toContain(secret);
    }
  });

  it('adds the hashed user once it is known, never the id', async () => {
    const response = await http().get('/api/probe/user').expect(200);
    const id = response.headers['x-request-id'] as string;

    expect(linesOf(id).find((line) => line.msg === 'signed-in probe')).toMatchObject({
      userHash: hashUserId(SECRET, USER_ID),
    });
    expect(JSON.stringify(lines)).not.toContain(USER_ID);
  });

  it('logs a fault at error level without its message, and a 4xx as a warning', async () => {
    await http().get('/api/probe/fail').expect(500);
    await http().get('/api/no-such-route').expect(404);

    expect(completion('/api/probe/fail')).toMatchObject({ level: 50, res: { statusCode: 500 } });
    expect(completion('/api/no-such-route')).toMatchObject({ level: 40, res: { statusCode: 404 } });
    expect(JSON.stringify(lines)).not.toContain(EMAIL);
  });

  it('does not log a successful health probe', async () => {
    await http().get('/api/health').expect(200);
    expect(completion('/api/health')).toBeUndefined();
  });

  it('logs a failing health probe (503) as an error', async () => {
    healthStatus = 503;
    await http().get('/api/health').expect(503);
    expect(completion('/api/health')).toMatchObject({ level: 50, res: { statusCode: 503 } });
  });

  it('logs an error object with its class and frames, never its message (SC-15)', () => {
    new Logger('Probe').error(new TypeError(`no user ${EMAIL}`));

    const line = lines.find((entry) => entry.context === 'Probe');
    expect(line?.err).toMatchObject({ type: 'TypeError', stack: expect.stringMatching(/^\s+at /) });
    expect(line?.err).not.toHaveProperty('message');
    // pino would take the message as `msg`; the hook puts the class name there instead.
    expect(line?.msg).toBe('TypeError');
    expect(JSON.stringify(lines)).not.toContain(EMAIL);
  });

  it("keeps the text our code wrote with logger.error(message, stack), like the filter's", async () => {
    await http().get('/api/probe/fail').expect(500);

    const line = lines.find((entry) => entry.context === 'ApiExceptionFilter');
    expect(line).toMatchObject({
      level: 50,
      msg: 'Unhandled Error on GET /api/probe/fail',
      err: { type: 'Error', stack: expect.stringMatching(/^\s+at /) },
    });
  });

  it('gives a job run its own correlation id and job name', async () => {
    await runInJobContext('auctions-import', async () => {
      new Logger('AuctionsImporter').log('Starting auctions import (AUTO mode)');
    });

    expect(lines.find((line) => line.context === 'AuctionsImporter')).toMatchObject({
      jobName: 'auctions-import',
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });
});

describe('logger serializers (SC-15)', () => {
  const raw = (fields: object) => fields as Parameters<typeof routeOf>[0];

  it('prefers the matched route pattern, else the path without its query string or fragment', () => {
    expect(
      routeOf(raw({ route: { path: '/api/auctions/:code' }, url: '/api/auctions/1?x=1' })),
    ).toBe('/api/auctions/:code');
    expect(routeOf(raw({ originalUrl: '/api/x?email=a', url: '/x' }))).toBe('/api/x');
    expect(routeOf(raw({ route: { path: '/api{/*splat}' }, originalUrl: '/api/z?q=1' }))).toBe(
      '/api/z',
    );
    expect(routeOf(raw({ url: '/api/y#frag' }))).toBe('/api/y');
    expect(routeOf(raw({}))).toBe('');
  });

  it('keeps only the method of a request, and the status of a response', () => {
    const req = raw({ method: 'POST', url: '/api/auth/login?next=1', headers: { cookie: COOKIE } });
    expect(serializeRequest({ raw: req })).toEqual({ method: 'POST' });
    expect(serializeResponse({ statusCode: 201 })).toEqual({ statusCode: 201 });
  });

  it('keeps an error class and its frames: no message, no enumerable properties', () => {
    const error = Object.assign(
      new TypeError(`E11000 { email: "${EMAIL}" }\nsecond line ${EMAIL}`),
      { keyValue: { email: EMAIL } },
    );
    const serialized = serializeError(error);

    expect(Object.keys(serialized).sort()).toEqual(['stack', 'type']);
    expect(serialized.type).toBe('TypeError');
    // The frames as they were, from the first `at` line on (the message took two lines).
    expect(serialized.stack).toBe(error.stack?.split('\n').slice(2).join('\n'));
    expect(JSON.stringify(serialized)).not.toContain(EMAIL);
    expect(serializeError('text')).toEqual({ type: 'string' });
    expect(serializeError(null)).toEqual({ type: 'object' });
  });

  it("reads the original error off pino-http's wrapped one", () => {
    const error = new TypeError(`no user ${EMAIL}`);
    const wrapped = { type: 'TypeError', message: error.message, raw: error };
    expect(serializeError(wrapped)).toEqual({
      type: 'TypeError',
      stack: stackFrames(error.stack ?? ''),
    });
  });

  it('serializes an error without a stack as its class alone', () => {
    const error = new RangeError('x');
    delete error.stack;
    expect(serializeError(error)).toEqual({ type: 'RangeError' });
  });

  it('keeps a stack that is frames only, and drops a stack with none', () => {
    const frames = '    at a (a.ts:1)\n    at b (b.ts:2)';
    expect(stackFrames(frames)).toBe(frames);
    expect(stackFrames(`Error: ${EMAIL}`)).toBe('');
  });

  describe('logMethod hook', () => {
    function call(...args: unknown[]) {
      const method = vi.fn();
      logMethod.call({} as never, args as never, method as never);
      return method.mock.calls[0];
    }

    it('gives a lone error, or { err } alone, its class name as the message', () => {
      const error = new TypeError(`no user ${EMAIL}`);
      expect(call(error)).toEqual([{ err: error }, 'TypeError']);
      expect(call(error, undefined)).toEqual([{ err: error }, 'TypeError']);
      expect(call({ err: error, context: 'X' })).toEqual([
        { err: error, context: 'X' },
        'TypeError',
      ]);
    });

    it('keeps the message nestjs-pino built from logger.error(message, stack)', () => {
      const error = Object.assign(new Error('Unhandled Error on GET /api/x'), {
        stack: '    at handler (x.ts:1)',
      });
      expect(call({ err: error })).toEqual([{ err: error }, 'Unhandled Error on GET /api/x']);
      const noStack = new RangeError('x');
      delete noStack.stack;
      expect(call(noStack)).toEqual([{ err: noStack }, 'RangeError']);
    });

    it('leaves every other call as it was', () => {
      const error = new Error('x');
      expect(call('plain text')).toEqual(['plain text']);
      expect(call({ err: error }, 'own message')).toEqual([{ err: error }, 'own message']);
      expect(call({ err: 'not an error' })).toEqual([{ err: 'not an error' }]);
      expect(call({ context: 'X' })).toEqual([{ context: 'X' }]);
      expect(call(null)).toEqual([null]);
    });
  });

  it('picks the level: error, warn, info, and silent for a successful health probe only', () => {
    const req = (url: string) => ({ url }) as Parameters<typeof requestLogLevel>[0];
    const res = (statusCode: number) => ({ statusCode }) as Parameters<typeof requestLogLevel>[1];
    expect(requestLogLevel(req('/api/x'), res(200), new Error('x'))).toBe('error');
    expect(requestLogLevel(req('/api/x'), res(503))).toBe('error');
    expect(requestLogLevel(req('/api/x'), res(404))).toBe('warn');
    expect(requestLogLevel(req('/api/x'), res(200))).toBe('info');
    expect(requestLogLevel(req('/api/health'), res(200))).toBe('silent');
    expect(requestLogLevel(req('/api/health?probe=1'), res(204))).toBe('silent');
    expect(requestLogLevel(req('/api/health'), res(304))).toBe('info');
    expect(requestLogLevel(req('/api/health'), res(101))).toBe('info');
    expect(requestLogLevel(req('/api/health'), res(503))).toBe('error');
    expect(requestLogLevel(req('/api/health'), res(200), new Error('x'))).toBe('error');
  });

  it('redacts headers, query, body and the fields that name a person', () => {
    expect(REDACT_PATHS).toEqual(
      expect.arrayContaining([
        'req.headers',
        'req.query',
        'req.body',
        '*.email',
        '*.cpf',
        '*.phone',
      ]),
    );
  });
});
