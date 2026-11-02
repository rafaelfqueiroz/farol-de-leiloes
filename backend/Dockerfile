# DEVELOPMENT §12 (deploy.yml builds and pushes this image). Every stage uses the exact Node
# version from .node-version (DV-05; test/structural/node-version.spec.ts checks the tag).

# --- build: compile, then drop dev dependencies -------------------------------------------
FROM node:24.22.2-slim AS build
WORKDIR /app
# Chromium comes from Debian in the runtime stage, never from puppeteer's download.
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json ./
# npm 11 skips dependency install scripts. Nothing here needs them: bcrypt 6 loads a prebuilt
# binding shipped in its tarball (no compiler), and the browser is installed below.
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# --- runtime ------------------------------------------------------------------------------
FROM node:24.22.2-slim AS runtime
# SC-24: plain Debian Chromium for the detail-page scraper, launched undisguised by puppeteer.
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-liberation \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
  PUPPETEER_SKIP_DOWNLOAD=true \
  PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app
# The application files stay owned by root, so the process cannot rewrite its own code.
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
# No HEALTHCHECK until GET /api/health exists (AR-48). Runtime configuration and secrets come
# from the host's environment, never from the image (SC-16, DV-35).
CMD ["node", "dist/main.js"]
