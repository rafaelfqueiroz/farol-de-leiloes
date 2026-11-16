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

E2E tests: `npm run test:e2e` runs Playwright (`e2e/`, `playwright.config.ts`) against its own Compose stack (`e2e/compose.e2e.yml`), which it builds, seeds and tears down; Docker must be running, and `npx playwright install chromium` once. See TESTING §6.

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
- `proxyToBackend(request, path, { auth, query, startsSession })` forwards the request method and raw body (none for GET and DELETE) and only the `Authorization: Bearer` header, which it builds from the session cookie (the browser's own `Authorization` header and cookies are never forwarded), and the caller's `X-Forwarded-For` chain (`lib/forwarded-for.ts`: Caddy's chain unchanged when every entry is a valid IP address and there are at most 5, otherwise none), so the backend's per-origin limits (SC-04) see the browser and not the BFF. The AI search route (`app/api/chat`) forwards the chain the same way; the sitemap and the cached auction page are not per-caller and forward none. It sends `Content-Type: application/json` when there is a body.
- `auth: true` without a session cookie answers 401 `UNAUTHENTICATED` without calling the backend. A backend 401 never touches the cookie (see Session cookie).
- `startsSession: true` (login, register, the Google exchange and complete) moves the backend's `accessToken` into the session cookie and answers the browser without it (`{ user }`, or `{ status, user }`). A first Google sign-in (`terms_required`) sets no cookie.
- A state-changing request (POST, PUT, PATCH, DELETE) from another origin is answered 403 `FORBIDDEN` before anything else, without calling the backend (see Session cookie).
- The backend's JSON answer passes through with its status, unchanged (AR-38). A non-JSON error status (a gateway page, an empty 5xx) becomes 502 `BACKEND_UNAVAILABLE`. A network failure also becomes 502 `BACKEND_UNAVAILABLE`.
- Logs carry the route, the error name and the message only, never a body, header or token (SC-15).

### Session cookie (SC-02)

The session token lives only in an `httpOnly`, `SameSite=Lax`, `Path=/` cookie that the route handlers set; browser JavaScript never sees it, and nothing in `localStorage`, `sessionStorage` or a URL holds it (`test/structural/session-token.test.ts` enforces this).

- `lib/session-cookie.ts`: the cookie is `__Host-farol_session` (with `Secure`) in production and `farol_session` otherwise, because a `__Host-` cookie cannot be set over plain http. It lasts 7 days, like the session (BR-001-18). Production reads only the `__Host-` name; development reads either.
- `POST /api/auth/logout` ends the session on the backend (best effort) and always clears the cookie. It is the only thing that clears it: a data request's 401 `UNAUTHENTICATED` does not. The BFF is stateless and cannot know which cookie the browser holds when a slow answer comes back, so a late 401 for an old session would wipe the cookie of a newer sign-in (BR-001-18). The dead cookie is `httpOnly` and harmless: the backend refuses it, and the next sign-in (login, register, the Google exchange) overwrites it.
- `lib/request-origin.ts`: for POST, PUT, PATCH and DELETE, `Origin` must equal the origin of `NEXT_PUBLIC_SITE_URL`, or `Sec-Fetch-Site` must be `same-origin` when `Origin` is absent. GET is exempt. **Set `NEXT_PUBLIC_SITE_URL=http://localhost:3001` locally**, otherwise every state-changing call from the dev server answers 403 `FORBIDDEN`.
- `lib/api-client.ts` (browser): `apiFetch` and `apiJson` call the same-origin `/api/*` routes with the cookie, turn a failure into an `ApiError` (AR-39) and tell `AuthContext` when a call answers 401 `UNAUTHENTICATED`, so the app signs the user out in one place. For the same reason the client keeps an **auth generation** (`currentAuthGeneration`, `bumpAuthGeneration`): a request notes it when it starts, and a 401 that arrives after the session changed (a sign-in, a sign-out, a newer lookup) is stale and signs nobody out. `AuthContext` bumps it on login, register, logout, a session that ended and every `loadUser`, and ignores the result of a `GET /api/auth/me` that was overtaken the same way; the login and register buttons stay disabled while the first lookup is pending. `AuthContext` derives "signed in" from `GET /api/auth/me`; favourites and reminders load once a user is known.

### Account pages (SPEC-001, issue #1 frames)

- `/register` sends `acceptTerms: true` with the sign-up (the box must be ticked first; the sentence is plain text until SPEC-010 adds the links) and offers "Entrar com Google". `/login` shows the refusals of BR-001-14, BR-001-15 and BR-001-08 in its alert.
- `/auth/callback` trades the single-use code for the session. For a person with no account yet the BFF answers `terms_required`, and the page keeps the code in memory (it was stripped from the URL) and asks for the terms: "Criar conta" calls `POST /api/auth/google/complete { code, acceptTerms: true }` (the BFF sets the cookie like the exchange); "Cancelar" calls `POST /api/auth/google/cancel` and replaces the page with `/login`. Any other failure is the "Não foi possível entrar com o Google" screen.
- `/profile` edits name and phone only and sends `{ name, phone }` to `PATCH /api/auth/profile`; the e-mail is shown read-only for every account (BR-001-26). A Google-only account sees "Criar senha" instead of "Alterar senha". CPF, birth date, sex and address are neither shown nor collected; values already stored are left alone until SPEC-010.
- The shell's `banner` slot holds `components/account/EmailVerificationBanner`: the one warning for an account whose e-mail is not confirmed, with "Reenviar link" (`POST /api/auth/resend-verification`). The guarded features' 403 `EMAIL_VERIFICATION_REQUIRED` is "nothing to show" for the favourites, reminders and saved-filters loads (`isEmailVerificationRequired`); their forms show its catalogue text.

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
| `lib/`                         | Server and shared helpers: `env.ts`, `backend.ts`, `session-cookie.ts`, `api-client.ts`, money and dates        |
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
