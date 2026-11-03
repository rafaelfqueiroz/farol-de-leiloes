// AR-42: this is the only file in the frontend that reads `process.env`; everything else imports
// `publicEnv` or `serverEnv()`. AR-44: every key below is listed, with a comment, in
// `frontend/.env.example` (test/structural/env-example.test.ts keeps the two in step).
import { z } from 'zod';

// An empty string is "not set": `KEY=` in a .env file must fall back to the default, not fail.
const optionalUrl = z.preprocess((value) => (value === '' ? undefined : value), z.url().optional());
const urlWithDefault = (fallback: string) =>
  z.preprocess((value) => (value === '' ? undefined : value), z.url().default(fallback));

// `https://host/` and `https://host` must build the same request URLs.
const withoutTrailingSlash = (url: string) => url.replace(/\/+$/, '');

// Browser-visible values. Non-secret by definition (anything `NEXT_PUBLIC_*` ships in the bundle),
// so a default is safe and lets `next build` run in CI with no environment at all.
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_AUCTIONS_API_URL:
    urlWithDefault('http://localhost:3000').transform(withoutTrailingSlash),
  NEXT_PUBLIC_SITE_URL: urlWithDefault('https://faroldosleiloes.com.br').transform(
    withoutTrailingSlash,
  ),
});

// Server-only values. Never `NEXT_PUBLIC_*`, and never read from a client component.
export const serverEnvSchema = z.object({
  // Where the Next.js server reaches the backend (BFF routes, SSR, sitemap). Falls back to the
  // public URL so a deploy that only set NEXT_PUBLIC_AUCTIONS_API_URL keeps working; set it
  // separately when the server reaches the backend by a private address.
  BACKEND_API_URL: optionalUrl.transform((url) => url && withoutTrailingSlash(url)),
});

export type PublicEnv = {
  /** Backend origin the browser calls, without a trailing slash and without `/api`. */
  apiUrl: string;
  /** Canonical site origin, for metadata, the sitemap and robots. */
  siteUrl: string;
};
export type ServerEnv = {
  /** Backend origin for server-side calls, without a trailing slash and without `/api`. */
  backendUrl: string;
};

export function parsePublicEnv(raw: Record<string, string | undefined>): PublicEnv {
  const parsed = publicEnvSchema.parse(raw);
  return {
    apiUrl: parsed.NEXT_PUBLIC_AUCTIONS_API_URL,
    siteUrl: parsed.NEXT_PUBLIC_SITE_URL,
  };
}

export function parseServerEnv(raw: Record<string, string | undefined>): ServerEnv {
  const parsed = serverEnvSchema.parse(raw);
  return { backendUrl: parsed.BACKEND_API_URL ?? parsePublicEnv(raw).apiUrl };
}

// Each `NEXT_PUBLIC_*` is a literal property access: Next.js inlines them at build time and
// cannot do so for `process.env[name]` or a spread of `process.env`.
export const publicEnv: PublicEnv = parsePublicEnv({
  NEXT_PUBLIC_AUCTIONS_API_URL: process.env.NEXT_PUBLIC_AUCTIONS_API_URL,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
});

// Lazy so that importing this module from a shared file never touches server-only values, and so
// that reading one from the browser fails loudly instead of yielding `undefined`.
export function serverEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error('serverEnv() was called in the browser (AR-42)');
  }
  return parseServerEnv({
    BACKEND_API_URL: process.env.BACKEND_API_URL,
    NEXT_PUBLIC_AUCTIONS_API_URL: process.env.NEXT_PUBLIC_AUCTIONS_API_URL,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });
}
