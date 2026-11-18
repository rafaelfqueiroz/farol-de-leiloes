# TS-22, DEVELOPMENT DV-18: the API image of the E2E Compose stack (frontend/e2e/compose.e2e.yml)
# and the image its `seed` service runs (SPEC-003 BR-003-08). Never published and never deployed:
# deploy.yml builds ./Dockerfile only. It keeps the dev dependencies, because the fake-provider
# entry point (test/e2e-stack/main.ts) compiles the app through @nestjs/testing, and it has no
# Chromium: the scraper is replaced by an inert fake. Same Node tag as every image (DV-05).
FROM node:24.22.2-slim
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.e2e.json ./
COPY src ./src
COPY scripts ./scripts
COPY test/e2e-stack ./test/e2e-stack
COPY test/fakes ./test/fakes
# the fake payment gateway builds provider prices with the test builder (SPEC-012)
COPY test/builders ./test/builders
RUN npx tsc -p tsconfig.e2e.json
USER node
EXPOSE 3000
CMD ["node", "dist-e2e/test/e2e-stack/main.js"]
