// SPEC-010 BR-010-14, BR-010-15: the closure and purge rules of the account document (hand-written
// expectations, TS-04).
import { describe, expect, it } from 'vitest';
import {
  CLOSABLE_STATUSES,
  PURGE_CLAIM_FIELDS,
  PURGE_REMOVED_FIELDS,
  purgedEmail,
  purgedEmailWithSuffix,
} from './account-closure.js';

describe('BR-010-14: which accounts can be closed', () => {
  it('lists exactly active and deactivated: closed is final, a second closure is not a transition', () => {
    expect([...CLOSABLE_STATUSES]).toEqual(['active', 'deactivated']);
  });
});

describe('BR-010-15: what the purge removes from the account document', () => {
  it('removes every identifying, sign-in and legacy field, and keeps the ones the records refer to', () => {
    expect([...PURGE_REMOVED_FIELDS].sort()).toEqual(
      [
        'name',
        'phone',
        'googleId',
        'password',
        'providers',
        'emailVerified',
        'isAdmin',
        'stripeCustomerId',
        'stripeSubscriptionId',
        'subscriptionStatus',
      ].sort(),
    );
    for (const kept of ['_id', 'email', 'status', 'closedAt', 'purgedAt', 'credentialVersion']) {
      expect(PURGE_REMOVED_FIELDS as readonly string[]).not.toContain(kept);
    }
  });

  it('names the claim fields and the fairness stamp of the attempts, all removed with the tombstone', () => {
    expect([...PURGE_CLAIM_FIELDS]).toEqual([
      'purgeClaimToken',
      'purgeClaimUntil',
      'lastPurgeAttemptAt',
      'purgeAttempts',
    ]);
  });

  it('replaces the email with one on the reserved .invalid domain that carries the id', () => {
    expect(purgedEmail('64b7f00000000000000ffff1')).toBe(
      'purged-64b7f00000000000000ffff1@removed.invalid',
    );
  });

  it('has a fallback with a random suffix, still on the reserved domain and carrying the id', () => {
    expect(purgedEmailWithSuffix('64b7f00000000000000ffff1', 'a1b2c3d4e5f60718')).toBe(
      'purged-64b7f00000000000000ffff1-a1b2c3d4e5f60718@removed.invalid',
    );
  });
});
