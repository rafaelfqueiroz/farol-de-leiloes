// AR-46 / SC-15: the user appears in logs only as a keyed hash of their id.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashUserId, USER_HASH_LENGTH } from './user-hash';

const SECRET = 'test-log-hash-secret-not-a-real-one-000';
const USER_ID = '64b7f0000000000000000001';

describe('hashUserId (AR-46)', () => {
  it('is the first 16 hex characters of HMAC-SHA256(secret, userId)', () => {
    // External authority (TS-04): Node's HMAC computed here, independently of the helper.
    const expected = createHmac('sha256', SECRET).update(USER_ID).digest('hex').slice(0, 16);

    expect(hashUserId(SECRET, USER_ID)).toBe(expected);
    expect(hashUserId(SECRET, USER_ID)).toMatch(/^[0-9a-f]{16}$/);
    expect(USER_HASH_LENGTH).toBe(16);
  });

  it('never contains the id, and depends on the key', () => {
    const hash = hashUserId(SECRET, USER_ID);
    expect(hash).not.toContain(USER_ID);
    expect(hashUserId(`${SECRET}-other`, USER_ID)).not.toBe(hash);
    expect(hashUserId(SECRET, '64b7f0000000000000000002')).not.toBe(hash);
  });

  it.each([undefined, ''])('logs no user at all without a key (%j): no fallback (AR-41)', (key) => {
    expect(hashUserId(key, USER_ID)).toBeUndefined();
  });
});
