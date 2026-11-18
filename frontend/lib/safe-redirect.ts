// A `next` query parameter says where to go after signing in (SPEC-012: "Entrar para assinar"
// returns to /plans). It comes from the address bar, so only a path inside this site is followed:
// anything with a scheme, a host, a protocol-relative start or a backslash would be an open
// redirect.
const SAFE_PATH = /^\/(?![/\\])[\w\-./~%]*(\?[\w\-.~%=&+]*)?$/;

/** The path to go to, or null when `raw` is absent or not a same-site path. */
export function safeNextPath(raw: string | null): string | null {
  if (raw === null || raw.length > 200) return null;
  return SAFE_PATH.test(raw) ? raw : null;
}
