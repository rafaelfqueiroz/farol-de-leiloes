/**
 * Reads one cookie from a `Cookie` request header. The API has no cookie-parsing middleware (it
 * has no browser sessions, SC-02 is satisfied by the bearer token), and the Google sign-in state
 * is the only cookie it reads, so this stays a tiny pure function instead of a new dependency
 * (SC-20). The value is returned as sent: the caller's values are base64url and `.`, which
 * nothing percent-encodes, and the caller verifies a signature over them anyway.
 *
 * The first cookie with the name wins (browsers send the most specific path first).
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== name) continue;
    const value = pair.slice(separator + 1).trim();
    return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1)
      : value;
  }
  return undefined;
}
