// AR-46 / SC-15: a user appears in logs only as a keyed hash of their id. HMAC-SHA256 with
// LOG_HASH_SECRET, so the hash cannot be recomputed from a user id without the key (unlike the
// unkeyed common/hash.ts, which must never be used for users). Truncated to 16 hex characters
// (64 bits): enough to tell users apart and follow one through the logs.
import { createHmac } from 'node:crypto';

export const USER_HASH_LENGTH = 16;

/**
 * The log hash of `userId`, or `undefined` without a secret: AR-41 allows no fallback key, so
 * with LOG_HASH_SECRET unset (outside production) the user id is left out of the logs entirely.
 */
export function hashUserId(secret: string | undefined, userId: string): string | undefined {
  if (!secret) return undefined;
  return createHmac('sha256', secret).update(userId).digest('hex').slice(0, USER_HASH_LENGTH);
}
