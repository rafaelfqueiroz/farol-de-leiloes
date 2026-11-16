// BR-001-08, BR-001-11: what the sign-in with Google asserts about a person, as plain values with
// no framework in sight (AR-05, AR-09). The strategy only translates passport's profile into this
// shape; the rules about it live in AuthService.
import type { Profile } from 'passport-google-oauth20';

export interface GoogleIdentity {
  /** Google's permanent account identifier (`sub`): never reused, unlike the email (BR-001-11). */
  googleId: string;
  /** Lower-cased and trimmed by the account layer; here exactly as Google sent it. */
  email: string;
  /** Whether Google itself says the person controls this address (BR-001-08). */
  emailVerified: boolean;
  name: string;
}

/** Longest name an account holds (BR-001-25). */
const MAX_NAME_LENGTH = 120;
/** Google documents `sub` as at most 255 ASCII characters. */
const MAX_GOOGLE_ID_LENGTH = 255;

/**
 * Strictly true only for the boolean `true` or the string 'true': anything else (false, null,
 * undefined, 1, 'True', 'yes', an object) is unverified. The library hands the claim through as
 * Google sent it, and some Google endpoints return it as a string.
 */
export function isVerifiedClaim(value: unknown): boolean {
  return value === true || value === 'true';
}

/**
 * Whether Google reports the email as verified. passport-google-oauth20 exposes the claim twice,
 * as `_json.email_verified` and as `emails[0].verified`; both are read, and when Google reports it
 * in more than one place every report must say verified. Not reported at all means unverified.
 */
export function googleReportsEmailVerified(profile: Profile): boolean {
  const reports: unknown[] = [];
  const raw = (profile as { _json?: { email_verified?: unknown } })._json;
  if (raw && raw.email_verified !== undefined) reports.push(raw.email_verified);
  const first = profile.emails?.[0] as { verified?: unknown } | undefined;
  if (first && first.verified !== undefined) reports.push(first.verified);
  return reports.length > 0 && reports.every(isVerifiedClaim);
}

/**
 * The identity behind a passport profile, or null when it lacks what the account needs: Google's
 * identifier or an email (the 'email' scope is requested, so a profile without one is refused).
 */
export function toGoogleIdentity(profile: Profile): GoogleIdentity | null {
  const googleId = typeof profile.id === 'string' ? profile.id : '';
  const email = profile.emails?.[0]?.value;
  if (googleId === '' || googleId.length > MAX_GOOGLE_ID_LENGTH) return null;
  if (typeof email !== 'string' || email.trim() === '') return null;
  const displayName = typeof profile.displayName === 'string' ? profile.displayName.trim() : '';
  // Google may omit the name; the account needs one, so fall back to the part before the @.
  const name = (displayName || (email.split('@')[0] ?? '').trim() || email.trim()).slice(
    0,
    MAX_NAME_LENGTH,
  );
  return { googleId, email, emailVerified: googleReportsEmailVerified(profile), name };
}
