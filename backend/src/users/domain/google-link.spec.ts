// DL-001-02, BR-001-10, BR-001-11, BR-001-16: the decision table of a Google identity meeting an
// existing account. The same table is held against MongoDB in
// test/integration/auth-google.spec.ts, which runs the real conditional update.
import { describe, expect, it } from 'vitest';
import { decideGoogleLink, type GoogleLinkSubject } from './google-link.js';

describe('decideGoogleLink', () => {
  it.each<[string, GoogleLinkSubject, string]>([
    ['confirmed, not linked: link, keep the password', { emailVerified: true }, 'linked_confirmed'],
    [
      'confirmed, not linked, missing status counts as active',
      { emailVerified: true, status: undefined },
      'linked_confirmed',
    ],
    [
      'confirmed, already this Google identity: idempotent',
      { emailVerified: true, googleId: 'g-1' },
      'linked_confirmed',
    ],
    [
      'not confirmed: take over (confirm, drop the password)',
      { emailVerified: false },
      'linked_unconfirmed',
    ],
    ['confirmation flag missing counts as not confirmed', {}, 'linked_unconfirmed'],
    [
      'googleId null counts as not linked',
      { emailVerified: true, googleId: null },
      'linked_confirmed',
    ],
    [
      'another Google identity linked: never re-linked',
      { emailVerified: true, googleId: 'g-other' },
      'google_conflict',
    ],
    [
      'another identity on an unconfirmed account is still a conflict, not a takeover',
      { emailVerified: false, googleId: 'g-other' },
      'google_conflict',
    ],
    ['deactivated', { emailVerified: true, status: 'deactivated' }, 'inactive'],
    ['closed', { emailVerified: false, status: 'closed' }, 'inactive'],
    ['inactive wins over a conflict', { status: 'closed', googleId: 'g-other' }, 'inactive'],
  ])('%s', (_label, subject, expected) => {
    expect(decideGoogleLink(subject, 'g-1')).toBe(expected);
  });
});
