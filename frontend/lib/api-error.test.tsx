import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { ApiError, readApiError, useApiErrorMessage } from './api-error';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('readApiError', () => {
  it('reads the code, the context and the status of an API error body (AR-38)', async () => {
    const error = await readApiError(
      json({ code: 'SAVED_FILTER_LIMIT_REACHED', context: { limit: 5 } }, 409),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'SAVED_FILTER_LIMIT_REACHED',
      context: { limit: 5 },
      status: 409,
    });
  });

  it('accepts a list in the context', async () => {
    const error = await readApiError(
      json({ code: 'VALIDATION_FAILED', context: { fields: ['email', 'name'] } }, 400),
    );
    expect(error.context).toEqual({ fields: ['email', 'name'] });
  });

  it('defaults a missing context to empty', async () => {
    const error = await readApiError(json({ code: 'NOT_FOUND' }, 404));
    expect(error).toMatchObject({ code: 'NOT_FOUND', context: {}, status: 404 });
  });

  it.each([
    ['a body that is not JSON', new Response('<html>Bad gateway</html>', { status: 502 })],
    ['a legacy { message } body', json({ message: 'Credenciais invalidas', statusCode: 401 }, 401)],
    ['a body without a code', json({ context: {} }, 400)],
    ['a context that is not a flat record', json({ code: 'X', context: { a: { b: 1 } } }, 400)],
    ['a null body', json(null, 500)],
  ])('falls back to UNKNOWN for %s', async (_name, response) => {
    const error = await readApiError(response);
    expect(error).toMatchObject({ code: 'UNKNOWN', context: {}, status: response.status });
  });
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

// the hook's message function, rendered inside the real pt-BR catalogue
function messageFn() {
  return renderHook(() => useApiErrorMessage(), { wrapper }).result.current;
}

describe('useApiErrorMessage', () => {
  it('turns a known code into its pt-BR message (AR-39)', () => {
    expect(messageFn()(new ApiError('INVALID_CREDENTIALS'))).toBe(
      messages.errors.INVALID_CREDENTIALS,
    );
  });

  it('interpolates the context into the message', () => {
    const message = messageFn();
    expect(message(new ApiError('SAVED_FILTER_LIMIT_REACHED', { limit: 5 }))).toContain(
      '5 filtros salvos',
    );
    expect(message(new ApiError('SAVED_FILTER_LIMIT_REACHED', { limit: 1 }))).toContain(
      '1 filtro salvo',
    );
    expect(message(new ApiError('PHONE_REQUIRED', { channel: 'whatsapp' }))).toContain('WhatsApp');
    expect(message(new ApiError('REMINDER_CHANNEL_NOT_IN_PLAN', { channel: 'SMS' }))).toContain(
      'SMS',
    );
  });

  it('accepts a list in the context without failing', () => {
    expect(messageFn()(new ApiError('VALIDATION_FAILED', { fields: ['email', 'name'] }))).toBe(
      messages.errors.VALIDATION_FAILED,
    );
  });

  it('answers the BFF-local codes', () => {
    expect(messageFn()(new ApiError('BACKEND_UNAVAILABLE', {}, 502))).toBe(
      messages.errors.BACKEND_UNAVAILABLE,
    );
  });

  it.each([
    ['a code the catalogue does not know', new ApiError('BRAND_NEW_CODE', {}, 400)],
    ['a code that is not UPPER_SNAKE_CASE', new ApiError('patterns.money.missing', {}, 400)],
    ['an inherited property name', new ApiError('constructor', {}, 400)],
    ['a network failure', new TypeError('Failed to fetch')],
    ['a plain Error', new Error('boom')],
    ['something that is not an Error', 'boom'],
    ['undefined', undefined],
  ])('falls back to errors.UNKNOWN for %s', (_name, error) => {
    expect(messageFn()(error)).toBe(messages.errors.UNKNOWN);
  });

  it('returns the same function across renders so it is safe in effect dependencies', () => {
    const { result, rerender } = renderHook(() => useApiErrorMessage(), { wrapper });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
