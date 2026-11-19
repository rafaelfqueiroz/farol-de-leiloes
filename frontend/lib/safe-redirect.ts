// A `next` query parameter says where to go after signing in (SPEC-012: "Entrar para assinar"
// returns to /plans). It comes from the address bar, so only a path inside this site is followed:
// anything with a scheme, a host, a protocol-relative start, a backslash, whitespace or a control
// character would be an open redirect, and so would anything percent-encoded, which a router may
// decode into one of those. Plain path characters only; no `..` segment; and never the BFF
// (`/api/…` is not a page to land on).
const SAFE_PATH = /^\/(?![/\\])[\w\-./~]*(\?[\w\-.~=&+]*)?$/;
const API_PREFIX = /^\/api(?:[/?]|$)/i;

/** The path to go to, or null when `raw` is absent or not a same-site page path. */
export function safeNextPath(raw: string | null): string | null {
  if (raw === null || raw.length > 200) return null;
  if (!SAFE_PATH.test(raw) || API_PREFIX.test(raw)) return null;
  // `..` segments are refused, not resolved (a `.`-leading name such as `.well-known` is a name)
  const path = raw.split('?')[0] ?? '';
  return path.split('/').includes('..') ? null : raw;
}
