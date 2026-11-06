import { publicEnv } from './env';

// SC-17: Next/Emotion receive a fresh nonce for HTML. Non-HTML responses use the
// same restrictive baseline, without permitting arbitrary inline scripts.
export function contentSecurityPolicy(nonce?: string): string {
  const nonceSource = nonce ? ` 'nonce-${nonce}'` : '';
  const connections = new Set([
    "'self'",
    new URL(publicEnv.apiUrl).origin,
    ...(publicEnv.sentryDsn ? [new URL(publicEnv.sentryDsn).origin] : []),
  ]);

  return [
    "default-src 'self'",
    `script-src 'self'${nonceSource}${nonce ? " 'strict-dynamic'" : ''}`,
    `style-src 'self'${nonceSource}`,
    // MUI's positioning and CSS variables use style attributes, which cannot carry nonces.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "font-src 'self'",
    `connect-src ${[...connections].join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
