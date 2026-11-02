import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportClientError } from './report-client-error';

afterEach(() => {
  vi.restoreAllMocks();
});

function spyOnConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(() => undefined);
}

describe('reportClientError', () => {
  it('reports the where label, the error name and its message', () => {
    const spy = spyOnConsoleError();

    reportClientError(new TypeError('Failed to fetch'), { where: 'FavoritesContext.load' });

    expect(spy).toHaveBeenCalledExactlyOnceWith(
      '[FavoritesContext.load] TypeError: Failed to fetch',
    );
  });

  it('does not report the stack, the cause or anything else attached to the error', () => {
    const spy = spyOnConsoleError();
    const error = new Error('boom', { cause: { token: 'secret-token-value' } });
    Object.assign(error, { payload: { email: 'someone@example.test' } });

    reportClientError(error, { where: 'api/auth/login POST' });

    const reported = JSON.stringify(spy.mock.calls);
    expect(reported).not.toContain('secret-token-value');
    expect(reported).not.toContain('someone@example.test');
    // a stack names the file it was thrown from
    expect(reported).not.toContain('report-client-error.test');
  });

  it('labels the report "unknown" when no context is given', () => {
    const spy = spyOnConsoleError();

    reportClientError(new Error('x'));

    expect(spy).toHaveBeenCalledExactlyOnceWith('[unknown] Error: x');
  });

  it('keeps a thrown string, which carries no stack', () => {
    const spy = spyOnConsoleError();

    reportClientError('plain failure', { where: 'somewhere' });

    expect(spy).toHaveBeenCalledExactlyOnceWith('[somewhere] NonError: plain failure');
  });

  it('reports a thrown object without echoing its contents', () => {
    const spy = spyOnConsoleError();

    reportClientError({ email: 'someone@example.test' }, { where: 'somewhere' });

    expect(spy).toHaveBeenCalledExactlyOnceWith('[somewhere] NonError: ');
  });

  it('survives null and undefined', () => {
    const spy = spyOnConsoleError();

    reportClientError(null, { where: 'a' });
    reportClientError(undefined, { where: 'b' });

    expect(spy).toHaveBeenCalledTimes(2);
  });
});
