import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { cspHeaderName } from './lib/env';
import { contentSecurityPolicy } from './lib/security-headers';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

// This directory. The root package-lock.json (hook tooling only) would otherwise make Next infer
// the repository root as the workspace root and nest the standalone output under `frontend/`.
const projectRoot = import.meta.dirname;

const nextConfig: NextConfig = {
  // The Docker image (frontend/Dockerfile, DEVELOPMENT §12) runs `.next/standalone/server.js`.
  // Vercel ignores this setting and keeps its own build output.
  output: 'standalone',
  outputFileTracingRoot: projectRoot,
  turbopack: { root: projectRoot },
  // SC-17: applies to every route, including static assets and BFF responses.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: cspHeaderName, value: contentSecurityPolicy() },
          // SC-17: host-only until every subdomain's HTTPS support has been audited.
          { key: 'Strict-Transport-Security', value: 'max-age=15552000' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
