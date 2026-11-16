// BR-001-10, BR-001-11, BR-001-16, DL-001-02: what happens when a Google identity meets an existing
// account. Pure (AR-05); `UsersService.linkGoogleIdentity` writes the same table as one atomic
// update, so this function is how the table is read, tested and explained, and the integration
// spec holds the database to it.

export type GoogleLinkDecision =
  /** Email was confirmed: Google is added, the password and the local provider stay. */
  | 'linked_confirmed'
  /**
   * Email was never confirmed: whoever set the password never proved they own the address, so
   * linking confirms the email, deletes the password and drops the local provider (pre-hijacking).
   */
  | 'linked_unconfirmed'
  /** Deactivated or closed: no sign-in by any method (BR-001-16). */
  | 'inactive'
  /** Another Google identity is already linked: never moved to this one (BR-001-11). */
  | 'google_conflict';

export interface GoogleLinkSubject {
  status?: string;
  emailVerified?: boolean;
  googleId?: string | null;
}

export function decideGoogleLink(subject: GoogleLinkSubject, googleId: string): GoogleLinkDecision {
  if ((subject.status ?? 'active') !== 'active') return 'inactive';
  if (subject.googleId != null && subject.googleId !== googleId) return 'google_conflict';
  return subject.emailVerified === true ? 'linked_confirmed' : 'linked_unconfirmed';
}
