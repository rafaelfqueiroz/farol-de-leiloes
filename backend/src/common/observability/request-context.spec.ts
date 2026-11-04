// AR-46: the per-request correlation id (request-context.ts).
import { describe, expect, it } from 'vitest';
import type { IncomingHttpHeaders } from 'node:http';
import { logContextFields } from './log-context';
import {
  REQUEST_ID_HEADER,
  requestContextMiddleware,
  resolveRequestId,
  SAFE_REQUEST_ID,
} from './request-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function exchange(headers: IncomingHttpHeaders = {}, id?: unknown) {
  const sent: Record<string, string> = {};
  const req: { id?: unknown; headers: IncomingHttpHeaders } = { headers, id };
  const res = { setHeader: (name: string, value: string) => (sent[name] = value) };
  return { req, res, sent };
}

describe('resolveRequestId (AR-46)', () => {
  it('keeps a safe incoming x-request-id and echoes it', () => {
    const { req, res, sent } = exchange({ [REQUEST_ID_HEADER]: 'bff-0123-abcd' });

    expect(resolveRequestId(req, res)).toBe('bff-0123-abcd');
    expect(req.id).toBe('bff-0123-abcd');
    expect(sent).toEqual({ [REQUEST_ID_HEADER]: 'bff-0123-abcd' });
  });

  it('mints a UUID when there is none', () => {
    const { req, res, sent } = exchange();
    const id = resolveRequestId(req, res);

    expect(id).toMatch(UUID);
    expect(sent[REQUEST_ID_HEADER]).toBe(id);
  });

  it.each([
    ['too short', 'abc1234'],
    ['too long', 'a'.repeat(65)],
    ['a newline (log injection)', 'abcdefgh\n{"level":60}'],
    ['an email', 'ana.teste@example.test'],
    ['spaces', 'abcd efgh ijkl'],
  ])('replaces an unsafe incoming id (%s) with a UUID', (_label, incoming) => {
    const { req, res } = exchange({ [REQUEST_ID_HEADER]: incoming });

    expect(resolveRequestId(req, res)).toMatch(UUID);
  });

  it('replaces a repeated header (an array) with a UUID', () => {
    const { req, res } = exchange({
      [REQUEST_ID_HEADER]: ['abcdefgh', 'ijklmnop'] as unknown as string,
    });
    expect(resolveRequestId(req, res)).toMatch(UUID);
  });

  it('accepts exactly 8 and 64 characters, the pattern bounds', () => {
    expect(SAFE_REQUEST_ID.test('a'.repeat(8))).toBe(true);
    expect(SAFE_REQUEST_ID.test('a'.repeat(64))).toBe(true);
  });

  it('is idempotent: an id already assigned wins over the header', () => {
    const { req, res, sent } = exchange({ [REQUEST_ID_HEADER]: 'other-0123' }, 'assigned-0123');

    expect(resolveRequestId(req, res)).toBe('assigned-0123');
    expect(sent[REQUEST_ID_HEADER]).toBe('assigned-0123');
  });

  it('does not trust an assigned id that is not safe', () => {
    const { req, res } = exchange({}, 42);
    expect(resolveRequestId(req, res)).toMatch(UUID);
  });
});

describe('requestContextMiddleware', () => {
  it('runs the rest of the request in a context carrying its id', () => {
    const { req, res } = exchange({ [REQUEST_ID_HEADER]: 'bff-0123-abcd' });
    let fields: Record<string, string> = {};

    requestContextMiddleware(req, res, () => {
      fields = logContextFields();
    });

    expect(fields).toEqual({ correlationId: 'bff-0123-abcd' });
    expect(logContextFields()).toEqual({});
  });
});
