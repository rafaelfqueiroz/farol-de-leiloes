// SPEC-010 BR-010-14, BR-010-15: the closure and purge rules of the account document (hand-written
// expectations, TS-04).
import { describe, expect, it } from 'vitest';
import {
  CLOSABLE_STATUSES,
  PURGE_CLAIM_FIELDS,
  PURGE_REMOVED_FIELDS,
  purgedEmail,
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
        'cpf',
        'dateOfBirth',
        'sex',
        'address',
        'stripeCustomerId',
        'stripeSubscriptionId',
        'subscriptionStatus',
      ].sort(),
    );
    for (const kept of ['_id', 'email', 'status', 'closedAt', 'purgedAt', 'credentialVersion']) {
      expect(PURGE_REMOVED_FIELDS as readonly string[]).not.toContain(kept);
    }
  });

  it('names the two claim fields', () => {
    expect([...PURGE_CLAIM_FIELDS]).toEqual(['purgeClaimToken', 'purgeClaimUntil']);
  });

  it('replaces the email with one on the reserved .invalid domain that carries the id', () => {
    expect(purgedEmail('64b7f00000000000000ffff1')).toBe(
      'purged-64b7f00000000000000ffff1@removed.invalid',
    );
  });
});
