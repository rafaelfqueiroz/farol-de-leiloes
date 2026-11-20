// DL-001-02, BR-001-10, BR-001-11, BR-001-16: the decision table of a Google identity meeting an
// existing account. The same table is held against MongoDB in
// test/integration/auth-google.spec.ts, which runs the real conditional update.
import { describe, expect, it } from 'vitest';
import {
  consentResetAfterLink,
  credentialVersionAfterLink,
  decideGoogleLink,
  type GoogleLinkDecision,
  type GoogleLinkSubject,
} from './google-link.js';

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

describe('credentialVersionAfterLink (DL-001-02)', () => {
  it.each<[string, number | undefined, GoogleLinkDecision, number]>([
    ['taking over an unconfirmed account bumps the version', 4, 'linked_unconfirmed', 5],
    ['a missing version counts as 0 and becomes 1 on takeover', undefined, 'linked_unconfirmed', 1],
    ['linking a confirmed account leaves the version', 4, 'linked_confirmed', 4],
    ['a missing version stays 0 on a confirmed link', undefined, 'linked_confirmed', 0],
    ['an inactive account is not touched', 2, 'inactive', 2],
    ['a conflict is not touched', 2, 'google_conflict', 2],
  ])('%s', (_label, current, decision, expected) => {
    expect(credentialVersionAfterLink(current, decision)).toBe(expected);
  });
});

describe('consentResetAfterLink (SPEC-010, DL-001-02)', () => {
  const NOW = new Date('2026-06-02T09:00:00.000Z');
  const EARLIER = new Date('2026-05-01T00:00:00.000Z');

  it('taking over an unconfirmed account starts a new consent generation at the takeover instant', () => {
    expect(consentResetAfterLink(undefined, 'linked_unconfirmed', NOW)).toEqual(NOW);
    expect(consentResetAfterLink(null, 'linked_unconfirmed', NOW)).toEqual(NOW);
    expect(consentResetAfterLink(EARLIER, 'linked_unconfirmed', NOW)).toEqual(NOW);
  });

  it.each<[GoogleLinkDecision]>([['linked_confirmed'], ['inactive'], ['google_conflict']])(
    'leaves the generation as it was for %s',
    (decision) => {
      expect(consentResetAfterLink(EARLIER, decision, NOW)).toEqual(EARLIER);
      expect(consentResetAfterLink(undefined, decision, NOW)).toBeNull();
      expect(consentResetAfterLink(null, decision, NOW)).toBeNull();
    },
  );
});
