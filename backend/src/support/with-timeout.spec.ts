// SPEC-009 BR-009-07: the time limit of a send, with fake timers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MailSendTimeoutError, orTimeout, TIMED_OUT, within } from './with-timeout.js';

afterEach(() => vi.useRealTimers());

describe('within', () => {
  it('answers the result of a promise that finishes in time, and leaves no timer behind', async () => {
    vi.useFakeTimers();

    await expect(within(Promise.resolve(7), 1000)).resolves.toBe(7);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('answers TIMED_OUT when the limit passes first, and ignores the late rejection', async () => {
    vi.useFakeTimers();
    let fail: (error: Error) => void = () => undefined;
    const slow = new Promise<number>((_resolve, reject) => (fail = reject));

    const answer = within(slow, 1000);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(answer).resolves.toBe(TIMED_OUT);
    fail(new Error('late')); // must not raise an unhandled rejection
    await vi.advanceTimersByTimeAsync(1);
  });

  it('passes on a rejection that comes in time', async () => {
    await expect(within(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });
});

describe('orTimeout', () => {
  it('rejects with MailSendTimeoutError, whose name is the code a log shows', async () => {
    vi.useFakeTimers();

    const answer = orTimeout(new Promise<void>(() => undefined), 20_000);
    const assertion = expect(answer).rejects.toMatchObject({ name: 'MailSendTimeoutError' });
    await vi.advanceTimersByTimeAsync(20_000);

    await assertion;
    expect(new MailSendTimeoutError().message).not.toContain('@');
  });

  it('answers the result in time', async () => {
    await expect(orTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });
});
