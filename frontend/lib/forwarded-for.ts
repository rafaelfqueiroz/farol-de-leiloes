// Server-side only. The client address the BFF hands to the backend (SC-04, BR-001-15).
//
// Browser -> Caddy -> frontend (this BFF) -> backend. Caddy discards any X-Forwarded-For the
// browser sent and appends the real peer (deploy/Caddyfile), so the header this server receives
// is trustworthy. The BFF passes the chain on UNCHANGED; the backend takes the client from it by
// hop count alone (TRUST_PROXY_HOPS): a leading entry a client injected is never read, and with 0
// hops the header is ignored. No new header and no shared secret.
import { isIP } from 'node:net';
import type { NextRequest } from 'next/server';

/** Caddy adds one entry, Cloudflare's proxy one more (deploy-and-rollback.md): 5 is generous. */
export const MAX_FORWARDED_FOR_ENTRIES = 5;

/**
 * The `X-Forwarded-For` chain to forward, or null when there is none to trust: the header is
 * absent, an entry is not a syntactically valid IPv4/IPv6 address (nothing else may ride along to
 * the backend), or the chain is longer than MAX_FORWARDED_FOR_ENTRIES. Entries are returned
 * trimmed and joined with ", ", in their original order.
 */
export function validForwardedFor(header: string | null): string | null {
  if (header === null) return null;
  const entries = header.split(',').map((entry) => entry.trim());
  if (entries.length > MAX_FORWARDED_FOR_ENTRIES) return null;
  // A zone id (`fe80::1%eth0`) passes isIP but is not a client address: refuse it too.
  if (entries.some((entry) => isIP(entry) === 0 || entry.includes('%'))) return null;
  return entries.join(', ');
}

/** The headers that carry the caller's address to the backend: `X-Forwarded-For`, or none. */
export function clientAddressHeaders(request: NextRequest): Record<string, string> {
  const chain = validForwardedFor(request.headers.get('x-forwarded-for'));
  return chain === null ? {} : { 'X-Forwarded-For': chain };
}
