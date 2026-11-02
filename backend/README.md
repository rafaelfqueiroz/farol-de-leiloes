Auctions API (NestJS 12 + MongoDB)

Overview

- Ingests daily CSVs from Caixa auctions (per state, option "Todos").
- Parses and normalizes fields, stores in MongoDB.
- Exposes REST endpoint to query by state, city, and modality.

Requirements

- Node.js 24.22.2 (pinned in `.node-version`; DV-05)
- MongoDB running locally or a connection string (to run the app)
- Docker running, for `test:integration` and `test:isolation` (Testcontainers starts MongoDB; DV-17)
- Chrome for the detail-page scraper: npm 11 does not run puppeteer's install script, so run `npx puppeteer browsers install chrome` once (production images install Chrome/Chromium explicitly; ARCHITECTURE §13)

Setup

1. Copy `.env.example` to `.env` and set `MONGODB_URI` if needed.
2. Install deps: `npm install`, and once at the repository root run `npm install` too to install the git hooks (husky + lint-staged)
3. Dev run: `npm run start:dev`
4. Build: `npm run build`, then `npm start`. The deploy image is `Dockerfile` (Debian Chromium for the scraper, non-root), built and pushed to GHCR by `deploy.yml` (DEVELOPMENT §12)
5. Before pushing: `npm run check` (typecheck + lint + format check + tests); the pre-push hook runs it when `backend/` changes (DV-37)

Tests (TESTING §2, §7)

- `npm test` — Vitest projects `unit` (`src/**/*.spec.ts`, next to the source) and `structural` (`test/structural/`); no Docker
- `npm run test:cov` — the same with the V8 coverage gate (`backend/vitest.config.mts`); lcov report in `coverage/`
- `npm run test:integration` — `test/integration/` against MongoDB from Testcontainers; needs Docker
- `npm run test:isolation` — `test/isolation/`, the owner-isolation gate; needs Docker (empty until #2)
- `npm run test:structural` — `test/structural/` alone: checks on the repository itself (Node pins, workflows, Dockerfiles, pre-push selection); the CI `structural` job
- Helpers: `test/support/` (database harness, fixture paths, `silence-logger.ts`: the Nest Logger is silent in every test project; to assert on a log, `vi.spyOn(Logger.prototype, 'error')`, see TESTING.md), `test/fakes/`, `test/builders/`; captured Caixa pages in `test/fixtures/caixa/`

API

- GET `/api/auctions?state=SP&city=Sao Paulo&modality=Compra Direta`
  - Query params: `state` (UF), `city` (prefix match), `modality` (case/accents-insensitive)
  - Pagination: `limit` (default 10, max 200), `offset`
  - List filters (`city`, `neighborhood`, `modality`) take several values as a repeated key (`?city=A&city=B`) or comma-separated (`?city=A,B`). Express 5 parses the query string with its `simple` parser, so bracket keys (`city[]=A`) are not lists

Scheduling

- A daily job runs at 03:00 (server time) to import all states.
- Also triggers one initial import ~5s after startup.

Notes

- CSV layout from Caixa can vary; the parser is resilient to common Portuguese headers and keeps the full `raw` row for reference.
- The download step tries GET with `?UF=<state>&Cidade=Todos`, then falls back to POST form if needed.
