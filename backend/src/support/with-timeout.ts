// SPEC-009 BR-009-07: a send is bounded in time, so a stalled SMTP server cannot hold a delivery past
// the claim's lease (domain/mail-outbox.ts). The underlying promise cannot be cancelled: when the limit
// wins, its late result is ignored (and a rejection of it is swallowed, never an unhandled rejection).

/** A send that did not finish in time; its name is the stable code the logs show (SC-15). */
export class MailSendTimeoutError extends Error {
  constructor() {
    super('The mail server did not answer in time');
    this.name = 'MailSendTimeoutError';
  }
}

/** The result of `promise`, or `undefined` marker `TIMED_OUT` when `ms` passed first. */
export const TIMED_OUT: unique symbol = Symbol('TIMED_OUT');

export async function within<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  // A late rejection of `promise` after the limit won must not surface as unhandled.
  promise.catch(() => undefined);
  try {
    return await Promise.race([promise, limit]);
  } finally {
    clearTimeout(timer);
  }
}

/** `promise`'s result, or a rejection with MailSendTimeoutError when `ms` passed first. */
export async function orTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const result = await within(promise, ms);
  if (result === TIMED_OUT) throw new MailSendTimeoutError();
  return result;
}
