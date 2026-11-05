import { captureException } from '@sentry/nextjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportClientError } from './report-client-error';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

function lastReport() {
  const [error, hint] = vi.mocked(captureException).mock.calls[0] ?? [];
  return { error: error as Error, hint };
}

describe('reportClientError', () => {
  it('reports the error name and message with the where label as a tag', () => {
    reportClientError(new TypeError('Failed to fetch'), { where: 'FavoritesContext.load' });

    const { error, hint } = lastReport();
    expect(error.name).toBe('TypeError');
    expect(error.message).toBe('Failed to fetch');
    expect(hint).toEqual({ tags: { where: 'FavoritesContext.load' } });
  });

  it('does not report the stack, the cause or anything else attached to the error', () => {
    const original = new Error('boom', { cause: { token: 'secret-token-value' } });
    Object.assign(original, { payload: { email: 'someone@example.test' } });

    reportClientError(original, { where: 'api/auth/login POST' });

    const { error } = lastReport();
    expect(error).not.toBe(original);
    expect(error.cause).toBeUndefined();
    expect(error.stack).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain('someone@example.test');
    expect(JSON.stringify(error)).not.toContain('secret-token-value');
  });

  it('labels the report "unknown" when no context is given', () => {
    reportClientError(new Error('x'));

    expect(lastReport().hint).toEqual({ tags: { where: 'unknown' } });
  });

  it('keeps a thrown string, which carries no stack', () => {
    reportClientError('plain failure', { where: 'somewhere' });

    const { error } = lastReport();
    expect(error.name).toBe('NonError');
    expect(error.message).toBe('plain failure');
  });

  it('reports a thrown object without echoing its contents', () => {
    reportClientError({ email: 'someone@example.test' }, { where: 'somewhere' });

    const { error } = lastReport();
    expect(error.message).toBe('');
    expect(JSON.stringify(error)).not.toContain('someone@example.test');
  });

  it('survives null and undefined', () => {
    reportClientError(null, { where: 'a' });
    reportClientError(undefined, { where: 'b' });

    expect(captureException).toHaveBeenCalledTimes(2);
  });
});
