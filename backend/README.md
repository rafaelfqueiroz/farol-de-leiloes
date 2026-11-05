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

1. Copy `.env.example` to `.env` and fill in every value: each secret and integration variable is required, and the API refuses to boot naming any that is missing or invalid (AR-41). Optional ones are marked in the file.
2. Install deps: `npm install`, and once at the repository root run `npm install` too to install the git hooks (husky + lint-staged)
3. Dev run: `npm run start:dev`
4. Build: `npm run build`, then `npm start`. The deploy image is `Dockerfile` (Debian Chromium for the scraper, non-root), built and pushed to GHCR by `deploy.yml` (DEVELOPMENT §12)
5. Before pushing: `npm run check` (typecheck + lint + format check + tests); the pre-push hook runs it when `backend/` changes (DV-37)

Migrations (AR-29, ADR-001)

- `npm run migrate` — after `npm run build`: applies the pending migrations in `src/migrations/registry.ts` to the database `MONGODB_URI` names (same validated environment as the API), records each in the `migrations` collection and stops at the first failure (exit 1). Safe to re-run. It runs **before** deploying code that depends on it (DV-34); until the deploy pipeline does it (BL-001, #40), run it by hand from your machine against the production database (MongoDB Atlas) first, with `node --env-file=.env.production dist/migrations/run.js` (see DEVELOPMENT §6). How to write one: DEVELOPMENT §6, "Migrations"

Tests (TESTING §2, §7)

- `npm test` — Vitest projects `unit` (`src/**/*.spec.ts`, next to the source) and `structural` (`test/structural/`); no Docker
- `npm run test:cov` — the same with the V8 coverage gate (`backend/vitest.config.mts`); lcov report in `coverage/`
- `npm run test:integration` — `test/integration/` against MongoDB from Testcontainers; needs Docker
- `npm run test:isolation` — `test/isolation/`, the owner-isolation gate; needs Docker (empty until #2)
- `npm run test:structural` — `test/structural/` alone: checks on the repository itself (Node pins, workflows, Dockerfiles, pre-push selection); the CI `structural` job
- Helpers: `test/support/` (database harness, fixture paths, `silence-logger.ts`: the Nest Logger is silent in every test project; to assert on a log, `vi.spyOn(Logger.prototype, 'error')`, see TESTING.md), `test/fakes/`, `test/builders/`; captured Caixa pages in `test/fixtures/caixa/`

API

- The reference is the OpenAPI document (AR-33): Swagger UI at `/api/docs` and the JSON at `/api/docs-json` on a running API, outside production only. There is no hand-written route table; the controller and DTO decorators are the source, and `src/openapi.spec.ts` holds them to the contract.
- Errors answer `{ code, context }` (AR-38). Lists take `page` and `pageSize` (max 100) and answer `{ items, total, page, pageSize }` (AR-35).
- Money is a string of reais over JSON, both ways (AR-17): `"1234.56"` — a dot, at most two decimals, no thousands separator. Responses round once to two places, half-even (AR-19). Coupon discounts are reais too (they were integer centavos before #34). In MongoDB money is `Decimal128` only: migration `0001-money-decimal128` converted the documents written before #34, and a reader refuses any other shape.

Observability (ARCHITECTURE §11)

- Logs are JSON lines on stdout from nestjs-pino behind the NestJS `Logger` (AR-45); `LOG_LEVEL` sets the level (default `info`). Every line carries a `correlationId`: the request's id (an incoming `x-request-id` is kept only when it matches `^[A-Za-z0-9-]{8,64}$`, otherwise a UUID; echoed in the response header) or, for a job run, its own id plus `jobName` (AR-46). A signed-in user appears only as `userHash`, an HMAC-SHA256 of the id keyed by `LOG_HASH_SECRET` (required in production; without it no user id is logged). Request lines hold method, route, status and response time; never headers, cookies, query strings or bodies, and a successful `/api/health` probe is not logged (a failing one is). Errors are logged as their class and stack frames, never their message (SC-15).
- Sentry (`@sentry/nestjs`) reports 5xx faults (tagged with method and route) and failed import and scraper runs (tagged with `jobName`), scrubbed of request data, user, messages, host name and all but the runtime and trace contexts (AR-47). It is inert without `SENTRY_DSN` and always in tests. `src/instrument.ts` reads the DSN from the process environment before `.env` is loaded, so set it in the host environment.
- `GET /api/health` (public): database reachability and the outcome and age of the last Caixa import; `503` only when the database is down (AR-48). The image's `HEALTHCHECK` calls it. Field by field: `docs/runbooks/health-check.md`.

Scheduling

- Every schedule is Brasília time, whatever the server's zone (AR-25): the import of all states at 03:00, the detail-page scraper at 06:00, reminders every 15 minutes.
- With `IMPORT_ON_START_UP=true`, one initial import also runs ~5s after startup.
- Every run of the import and the details scraper is recorded in `jobexecutions` with `status` `SUCCESS` or `FAILED` (and a stable `errorCode`, never a message). A failed run does not count as "ran recently", so the next scheduled run retries (AR-03).

Notes

- CSV layout from Caixa can vary; the parser is resilient to common Portuguese headers and keeps the full `raw` row for reference.
- The download step tries GET with `?UF=<state>&Cidade=Todos`, then falls back to POST form if needed.
