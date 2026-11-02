import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

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
};

export default withNextIntl(nextConfig);
