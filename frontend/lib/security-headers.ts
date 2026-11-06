import { publicEnv } from './env';

// Public configuration is fixed for this module's lifetime. Parse origins once,
// without carrying a Sentry DSN's public key or paths into connect-src (SC-17).
const connectionSources = [
  ...new Set([
    "'self'",
    new URL(publicEnv.apiUrl).origin,
    ...(publicEnv.sentryDsn ? [new URL(publicEnv.sentryDsn).origin] : []),
  ]),
].join(' ');
const staticDirectives = [
  // MUI's positioning and CSS variables use style attributes, which cannot carry nonces.
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "font-src 'self'",
  `connect-src ${connectionSources}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
const baselinePolicy = `default-src 'self'; script-src 'self'; style-src 'self'; ${staticDirectives}`;

// SC-17: interpolate only the per-request nonce; static responses use the baseline.
export function contentSecurityPolicy(nonce?: string): string {
  return nonce
    ? `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; style-src 'self' 'nonce-${nonce}'; ${staticDirectives}`
    : baselinePolicy;
}
