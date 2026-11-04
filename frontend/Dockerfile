# DEVELOPMENT §12 (deploy.yml builds and pushes this image). Every stage uses the exact Node
# version from .node-version (DV-05; test/structural/node-version.spec.ts in the backend checks
# the tag). Next.js `output: 'standalone'` (next.config.ts) keeps the runtime stage to the
# server and the files it traces.

# --- build ----------------------------------------------------------------------------------
FROM node:24.22.2-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so they are build
# arguments. They are public by definition and never hold a secret (SC-16).
ARG NEXT_PUBLIC_AUCTIONS_API_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_AUCTIONS_API_URL=$NEXT_PUBLIC_AUCTIONS_API_URL \
  NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
  NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
RUN npm run build

# --- runtime ------------------------------------------------------------------------------
FROM node:24.22.2-slim AS runtime
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  PORT=3001 \
  HOSTNAME=0.0.0.0
WORKDIR /app
# The application files stay owned by root, so the process cannot rewrite its own code.
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# The one writable path: Next's runtime cache (image optimisation, revalidated pages).
RUN mkdir -p .next/cache && chown node:node .next/cache
USER node
EXPOSE 3001
# Server-side configuration and secrets come from the host's environment at runtime (SC-16).
CMD ["node", "server.js"]
