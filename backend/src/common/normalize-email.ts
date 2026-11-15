/**
 * BR-001-01: an email is the same account whatever its letter case, and surrounding spaces are
 * ignored. Every lookup and every write of an email goes through this one function.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
