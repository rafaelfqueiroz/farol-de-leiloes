# Farol dos Leilões — frontend

Next.js 16 App Router with MUI 7 and next-intl (pt-BR only), served on port 3001. Application data comes from the NestJS API (port 3000) through BFF route handlers under `app/api/`, which forward to the backend via `lib/backend.ts`. Two browser calls go to the backend directly: the neighborhoods lookup in `app/components/SearchFilters.tsx` and the Google sign-in redirect in `app/login/page.tsx`.

Guidelines: [ARCHITECTURE](../docs/guidelines/ARCHITECTURE.md), [DESIGN](../docs/guidelines/DESIGN.md), [DEVELOPMENT](../docs/guidelines/DEVELOPMENT.md), [TESTING](../docs/guidelines/TESTING.md), [SECURITY](../docs/guidelines/SECURITY.md).

## Requirements

- Node.js 24.22.2 (`.node-version` and `engines`; DV-05)
- The backend running on port 3000 (see `backend/README.md`)
- Git hooks: run `npm install` once at the repository root (husky and lint-staged)

## Setup

1. `npm ci`
2. `cp .env.example .env.local` and adjust (see [Environment](#environment))

## Running

- Development server: `npm run dev` (port 3001)
- Production build and server: `npm run build`, then `npm start` (port 3001; requires a build first)
- Container: `Dockerfile` builds a standalone image (`output: 'standalone'` in `next.config.ts`) that runs `node server.js` as a non-root user on port 3001. `NEXT_PUBLIC_*` values are build arguments; server-only values come from the runtime environment.

Agents never start the applications (DV-18); the developer runs them.

## Scripts

| Script         | Behaviour                                                                    |
| -------------- | ---------------------------------------------------------------------------- |
| `dev`          | `next dev -p 3001`                                                           |
| `build`        | `next build`                                                                 |
| `start`        | `next start -p 3001`                                                         |
| `typecheck`    | `tsc --noEmit`                                                               |
| `test`         | `vitest run` (all projects, no coverage)                                     |
| `test:cov`     | `vitest run --coverage`; thresholds in `vitest.config.ts`                    |
| `lint`         | `eslint .`; fails on new violations and on suppressions that no longer occur |
| `lint:fix`     | `eslint . --fix --pass-on-unpruned-suppressions`                             |
| `lint:prune`   | `eslint . --prune-suppressions` (shrinks `eslint-suppressions.json`)         |
| `format`       | `prettier --write .`                                                         |
| `format:check` | `prettier --check .`                                                         |
| `check`        | `typecheck` + `lint` + `format:check` + `test`                               |

`npm run check` is the definition of done (DV-20). The pre-push hook runs it in every package a push changes (DV-37), so it is also the gate before a push.

E2E tests (Playwright, `npm run test:e2e`) are not set up yet; they arrive with [#3](https://github.com/rafaelfqueiroz/farol-de-leiloes/issues/3) (TESTING §6).

## Environment

`lib/env.ts` is the only module that reads `process.env` (AR-42). Every variable it reads is listed with a comment in `.env.example`; `test/structural/env-example.test.ts` fails when the two differ (AR-44).

| Variable                       | Scope              | Default                          | Notes                                                                                                                    |
| ------------------------------ | ------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_AUCTIONS_API_URL` | Public, build time | `http://localhost:3000`          | Backend origin the browser reaches. Inlined into the bundle.                                                             |
| `NEXT_PUBLIC_SITE_URL`         | Public, build time | `https://faroldosleiloes.com.br` | Canonical origin for metadata, sitemap and robots. Set it to `http://localhost:3001` locally.                            |
| `NEXT_PUBLIC_SENTRY_DSN`       | Public, build time | unset (Sentry inert)             | Sentry DSN (public by design, SC-16). Events are scrubbed of bodies, headers, cookies, queries and users (AR-47, SC-15). |
| `BACKEND_API_URL`              | Server only        | `NEXT_PUBLIC_AUCTIONS_API_URL`   | Backend origin for route handlers, SSR and the sitemap. Set it when the server reaches the backend by a private address. |

- Values have no trailing slash and no `/api`.
- An empty value counts as unset.
- `publicEnv` is safe to import anywhere. `serverEnv()` throws when called in the browser (AR-42).
- No variable here is a secret. Secrets belong in the backend.

## Security headers

`next.config.ts` applies host-only HSTS (`max-age=15552000`, six months), `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and an explicit
CSP to every response (SC-17). Serve production through HTTPS; browsers honor HSTS over HTTPS.
HSTS does not include subdomains or preload: subdomains have not been audited for HTTPS support.

`proxy.ts` generates a fresh 128-bit nonce and replaces caller-supplied nonce/CSP headers on every
path, including missing API/asset URLs that may render the HTML 404. Next's runtime scripts,
MUI's color-scheme script and Emotion styles share that
nonce. Only style attributes allow `unsafe-inline`, because MUI uses them for positioning and CSS
variables; scripts never allow `unsafe-inline` or `unsafe-eval`. Connections are limited to this
origin and the configured public API/Sentry origins; property images may load over HTTPS.

Reading request headers in the root layout makes HTML dynamic. Do not cache HTML in a CDN: it
would reuse a nonce. Auction data fetches still revalidate hourly, independently of HTML rendering.
The proxy leaves `Cache-Control` to Next: dynamic HTML and errors are not stored, while icons,
brand images, robots and the sitemap retain their normal caching. JSON-LD is a non-executable
data block; escaping `<` protects its contents without a nonce.
Development sends this same policy as `Content-Security-Policy-Report-Only`, because Next's
development diagnostics require eval; production enforces `Content-Security-Policy`.

## BFF

`lib/backend.ts` is server-only. It is the one place route handlers reach the backend.

- `backendFetch(path, init)` calls `${BACKEND_API_URL}/api${path}`. The path must start with `/`.
- `proxyToBackend(request, path, { auth, query })` forwards the request method and raw body (none for GET and DELETE) and only the `Authorization` header. It sends `Content-Type: application/json` when there is a body.
- `auth: true` without an `Authorization` header answers 401 `UNAUTHENTICATED` without calling the backend.
- The backend's JSON answer passes through with its status, unchanged (AR-38). A non-JSON error status (a gateway page, an empty 5xx) becomes 502 `BACKEND_UNAVAILABLE`. A network failure also becomes 502 `BACKEND_UNAVAILABLE`.
- Logs carry the route, the error name and the message only, never a body, header or token (SC-15).

Example: `app/api/search/route.ts` keeps the known filter parameters and calls `proxyToBackend(request, '/auctions', { query })`.

AI search: `app/api/chat/route.ts` calls the backend's `/ai/extract-params`, then `/auctions` with the extracted filters. The language model lives in the backend (`backend/src/ai`); its provider is chosen by `LLM_PROVIDER` there.

## Errors and i18n

- The backend answers errors as `{ code, context }` (AR-37, AR-38).
- `readApiError(response)` in `lib/api-error.ts` turns a failed response into an `ApiError`. A body that is not `{ code, context }` becomes `UNKNOWN`.
- `useApiErrorMessage()` returns the pt-BR text for an error: `errors.<CODE>` in `messages/pt-BR.json`, with the context interpolated (AR-39). An unknown code shows `errors.UNKNOWN`.
- The frontend produces two codes itself: `UNKNOWN` and `BACKEND_UNAVAILABLE` (`FRONTEND_ERROR_CODES`). `UNAUTHENTICATED` comes from the BFF.
- `test/structural/error-catalogue.test.ts` reads `backend/src/common/errors/codes.ts` and fails when a backend code has no `errors.<CODE>` message (AR-39).
- Locale is pt-BR only (`i18n/config.ts`); there is no locale routing.
- Every user-facing string comes from `messages/pt-BR.json` through `useTranslations` / `getTranslations` (DS-20, AR-52); `react/jsx-no-literals` and a copy-props selector in `eslint.config.mjs` fail the build on a literal, with no suppressions. Keys are typed (`i18n/app-config.d.ts`), so a missing key is a compile error, and tests render with `renderWithProviders`, which throws on a missing key.
- Add a message under the area's namespace (`landing.hero.title`); words shared by several areas go in `common` or `plan`. One ICU message per sentence (`{count, plural, …}`, `t.rich` for links and bold). `test/structural/catalogue-vocabulary.test.ts` guards the one-wording-per-concept rule (DS-28).
- Numbers and dates are rendered only through the shared formatters (DS-29): `Money` / `formatMoney`, `DateText` / `formatDate`, `formatPercent` (`lib/money.ts`), `formatArea` and `formatCount` (`lib/numbers.ts`). No inline `toLocaleString`, `Intl` or `toFixed`.

## Project structure

| Path                           | Purpose                                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `app/`                         | App Router pages and layouts; `app/layout.tsx` is the root layout                                               |
| `app/(shell)/`                 | Pages inside the app shell (`layout.tsx`), including `auction/[code]/`                                          |
| `app/(shell)/(authenticated)/` | Signed-in pages (search, reminders, plans, admin, profile, support); the layout applies `RequireAuthentication` |
| `app/api/`                     | BFF route handlers, one folder per backend resource                                                             |
| `app/components/`              | Feature components and their tests                                                                              |
| `app/components/patterns/`     | Shared UI patterns (`AppShell`, `PageHeader`, `EmptyState`, `Money`, and others)                                |
| `app/contexts/`                | React contexts: auth, favorites, reminders, saved filters                                                       |
| `app/theme/`                   | MUI theme, colour tokens, fonts and the colour-scheme control                                                   |
| `lib/`                         | Server and shared helpers: `env.ts`, `backend.ts`, `api-error.ts`, money and date utilities                     |
| `i18n/`                        | next-intl configuration and request setup (pt-BR only)                                                          |
| `messages/`                    | `pt-BR.json`, the only message catalogue                                                                        |
| `public/brand/`                | Logo and brand SVGs                                                                                             |
| `test/`                        | Test setup, render helpers and `structural/` checks on the repository                                           |
| `proxy.ts`                     | Per-request CSP nonce for dynamic HTML                                                                          |
| `next.config.ts`               | next-intl plugin, standalone output and security headers                                                        |
| `Dockerfile`                   | Production image (build and runtime stages)                                                                     |

## Testing

- Vitest with jsdom, Testing Library and vitest-axe. Tests sit next to the code (`*.test.ts(x)`); `test/structural/` checks the repository itself.
- `vitest.config.ts` defines the projects: `unit` (all `*.test.ts(x)` except the date tests) and one `dates:<zone>` project per zone (`dates:America/Los_Angeles`, `dates:America/Sao_Paulo`, `dates:Asia/Tokyo`) for the date regressions. Run one with `npx vitest run --project dates:America/Sao_Paulo`.
- Coverage thresholds are in `vitest.config.ts`. `npm run test:cov` enforces them.
- Rules: [TESTING.md](../docs/guidelines/TESTING.md).

## Conventions

Branches, Conventional Commits, the pull request flow and agent rules are in [DEVELOPMENT.md](../docs/guidelines/DEVELOPMENT.md). Update the affected docs in the same PR (DV-29).
