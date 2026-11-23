import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureReauthReturn,
  clearReauthReturn,
  currentReauthReturn,
  subscribeReauthReturn,
} from './reauth-return';

afterEach(() => clearReauthReturn());

const history = () => ({ replaceState: vi.fn() });

// SPEC-010 BR-010-13: the one-time code leaves the address the moment the app starts.
describe('captureReauthReturn', () => {
  it('keeps the code in memory and replaces the history entry with the plain path', () => {
    const h = history();

    const captured = captureReauthReturn(
      { pathname: '/profile/privacidade', search: '?reauth=one-time-code' },
      h,
    );

    expect(captured).toBe(true);
    expect(h.replaceState).toHaveBeenCalledWith(null, '', '/profile/privacidade');
    expect(currentReauthReturn()).toEqual({ code: 'one-time-code', error: null });
  });

  it('keeps the reason, and no code, when Google was refused', () => {
    const h = history();

    captureReauthReturn(
      { pathname: '/profile/privacidade', search: '?reauthError=GOOGLE_SIGN_IN_FAILED' },
      h,
    );

    expect(h.replaceState).toHaveBeenCalledTimes(1);
    expect(currentReauthReturn()).toEqual({ code: null, error: 'GOOGLE_SIGN_IN_FAILED' });
  });

  it('treats an empty code as no code', () => {
    captureReauthReturn({ pathname: '/profile/privacidade', search: '?reauth=' }, history());

    expect(currentReauthReturn()).toEqual({ code: null, error: null });
  });

  it.each([
    ['another page', '/search', '?reauth=x'],
    ['the privacy page of nothing in the query', '/profile/privacidade', ''],
    ['an unrelated query', '/profile/privacidade', '?x=1'],
    ['a lookalike path', '/profile/privacidade/x', '?reauth=x'],
  ])('does nothing on %s', (_label, pathname, search) => {
    const h = history();

    expect(captureReauthReturn({ pathname, search }, h)).toBe(false);
    expect(h.replaceState).not.toHaveBeenCalled();
    expect(currentReauthReturn()).toBeNull();
  });

  it('tells subscribers when it captures and when it is cleared, and stops after unsubscribing', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeReauthReturn(listener);

    captureReauthReturn({ pathname: '/profile/privacidade', search: '?reauth=x' }, history());
    clearReauthReturn();
    clearReauthReturn(); // nothing to clear: no second notice
    unsubscribe();
    captureReauthReturn({ pathname: '/profile/privacidade', search: '?reauth=y' }, history());

    expect(listener).toHaveBeenCalledTimes(2);
  });
});
