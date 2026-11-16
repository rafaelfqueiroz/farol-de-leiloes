import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * The Google sign-in state travels in a cookie the browser sends back on the callback, so the
 * server keeps no session for it (SC-02, issue #152). The cookie value is
 * `<base64url(JSON {state, verifier, expiresAt})>.<base64url(HMAC-SHA256)>`: a value this server
 * did not seal, or one that was altered, or one past its time, opens to nothing.
 *
 * Pure: the key and the current time are arguments (AR-24), nothing is logged, nothing is thrown.
 */

/** How long a person has to finish the Google consent screen. */
export const GOOGLE_STATE_TTL_MS = 10 * 60 * 1000;

// Binds the derived key to this one use, so the signing secret is never also the key of anything
// else made from the same JWT_SECRET.
const KEY_LABEL = 'google-oauth-state';

export interface GoogleOAuthState {
  /** The random value sent to Google as `state`. */
  state: string;
  /** The PKCE code verifier whose S256 challenge was sent to Google. */
  verifier: string;
}

/** HKDF-SHA256 of the signing secret under this module's own label (no new env variable). */
export function deriveStateKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), KEY_LABEL, 32));
}

const mac = (key: Buffer, body: string): Buffer => createHmac('sha256', key).update(body).digest();

export function sealState(key: Buffer, value: GoogleOAuthState, now: Date): string {
  const body = Buffer.from(
    JSON.stringify({ ...value, expiresAt: now.getTime() + GOOGLE_STATE_TTL_MS }),
  ).toString('base64url');
  return `${body}.${mac(key, body).toString('base64url')}`;
}

/** The sealed state, or `null` for anything that is not an unaltered, unexpired one. */
export function openState(key: Buffer, sealed: string, now: Date): GoogleOAuthState | null {
  const parts = sealed.split('.');
  const [body, signature] = parts;
  if (parts.length !== 2 || !body || !signature) return null;

  const given = Buffer.from(signature, 'base64url');
  const expected = mac(key, body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null; // signed by us but not JSON: cannot happen unless the key leaked
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const { state, verifier, expiresAt } = payload as Record<string, unknown>;
  if (typeof state !== 'string' || state === '') return null;
  if (typeof verifier !== 'string' || verifier === '') return null;
  if (typeof expiresAt !== 'number' || now.getTime() >= expiresAt) return null;
  return { state, verifier };
}

/** Whether two strings are equal, in time that does not depend on where they differ. */
export function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
