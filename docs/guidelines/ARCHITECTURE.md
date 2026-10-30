# Architecture Guidelines

| | |
|---|---|
| **Status** | Draft v1.0 |
| **Companion docs** | [DEVELOPMENT.md](DEVELOPMENT.md), [TESTING.md](TESTING.md), [SECURITY.md](SECURITY.md), [DESIGN.md](DESIGN.md) |

How the system is shaped. Rules are numbered `AR-nn` and are cited from code comments, commits and PRs the same way spec rules (`BR-NNN-nn`) are.

Where a rule describes code that does not exist yet, the follow-up issue that builds it is the place the gap is tracked. The rule is still the rule: new code follows it from the day it is merged.

## 1. Stack

| Concern | Choice |
|---|---|
| Language | TypeScript, `strict` on both sides (DV-01) |
| Backend | NestJS · Mongoose · Passport (local + Google) |
| Database | MongoDB 7 |
| Frontend | Next.js App Router · React · MUI (DESIGN.md) · next-intl (pt-BR) |
| Money | `Decimal128` in MongoDB, `decimal.js` in code, strings over JSON (§5) |
| Dates | `date-fns` + `@date-fns/tz`, Brasília time (§6) |
| Validation | `class-validator` DTOs at the API edge (backend) · Zod (frontend, config) |
| Payments | Stripe |
| Files | Cloudflare R2, presigned URLs |
| Email / messaging | SMTP (Nodemailer) · SMS / WhatsApp providers |
| AI | OpenAI, behind a port (§4) |
| Logs / errors | `nestjs-pino` · Sentry (§11) |
| Tests | Jest (backend) · Vitest + Testing Library (frontend) · Testcontainers · Playwright |
| Runtime | Node 24 LTS, pinned everywhere (DV-05) |
| Hosting | Undecided. Deploy is gated off (DEVELOPMENT §8, BL-001) |

## 2. Runtime topology

```
Browser ──► Next.js (frontend/, :3001)
              ├─ Server components / route handlers ──► NestJS API (backend/, :3000) ──► MongoDB
              └─ /api/* proxy routes ─────────────────┘        │
                                                               ├─► Stripe, OpenAI, SMTP, SMS/WhatsApp
                                                               ├─► Cloudflare R2 (presigned URLs)
                                                               └─► Caixa (daily list + detail pages)
Scheduled jobs (@nestjs/schedule, in the backend process):
  Caixa import (SPEC-004) · detail-page enrichment · reminders · digests · Radar · retention purge
```

| | |
|---|---|
| **AR-01** | The browser talks only to Next.js. The backend URL and every secret stay server-side; the frontend reaches the API through server components, route handlers and `/api/*` proxy routes. |
| **AR-02** | The backend is the only process that touches MongoDB, R2 and third-party APIs. Next.js never opens a database connection. |
| **AR-03** | Every scheduled job is idempotent and safe to re-run after a crash halfway through. Each run is recorded (start, end, outcome, counts) — the Import Run of SPEC-004 BR-004-27 is the model. |
| **AR-04** | Every job has an `*_ENABLED` flag, off in tests and in the Compose test services. A job that cannot be switched off cannot be tested in isolation. |

## 3. Layering — a pure domain inside each module

Each backend module is a domain concept (`journeys/`, `offices/`, `viability/`), not a technical layer. Inside it:

```
backend/src/<module>/
  domain/            pure rules and calculations — no framework, no I/O
  <module>.service.ts         orchestrates: loads, calls domain, saves
  <module>.repository.ts      the only file that touches the Mongoose model
  <module>.controller.ts      HTTP edge: DTOs, guards, OpenAPI decorators
  schemas/           Mongoose schemas
  dto/               request/response DTOs
```

| | |
|---|---|
| **AR-05** | **`domain/` imports no framework.** No `@nestjs/*`, no `mongoose`, no `fs`, no HTTP client, no `process.env`, no `Date.now()`. It receives everything it needs as arguments, including the current time (AR-17). Enforced by an ESLint `no-restricted-imports` rule on `**/domain/**`. |
| **AR-06** | Business rules and calculations live in `domain/`: the viability calculator (SPEC-014), match score and Radar (SPEC-013), plan entitlements and limits (SPEC-012), phase-transition rules and phase averages (SPEC-016, SPEC-019), cost and contribution settlement (SPEC-018), holdings totals (SPEC-022), the CSV parser and change detection (SPEC-004). These are the **critical modules** with the 100% branch gate (TS-24). |
| **AR-07** | Controllers hold no logic beyond mapping a request to a service call. A controller method longer than about 15 lines is a service method waiting to be extracted. |
| **AR-08** | Services never call `Model.find*` directly. Data access goes through the module's repository, which is where ownership scoping lives (AR-12). |
| **AR-09** | Modules talk to each other through exported services, never by importing another module's repository, schema or model. A module that needs another's data asks its service. |
| **AR-10** | Each external system sits behind a port named for the role, not the vendor: `PaymentGateway` (Stripe), `LanguageModel` (OpenAI), `FileStore` (R2), `Mailer` (SMTP), `CaixaSource`. The adapter takes the vendor name. Tests use hand-written fakes of the port (TS-03). |

## 4. Ownership and isolation

SPEC-002 is the source of truth. The architectural consequences:

| | |
|---|---|
| **AR-11** | Every client-data collection carries `ownerType` (`'office' \| 'self_advised'`) and `ownerId` (SPEC-002 BR-002-01), required, set once at creation, never updated. Every compound index on it starts with `{ ownerType: 1, ownerId: 1 }`. |
| **AR-12** | **Every read and write of an owned collection goes through a repository extending `OwnerScopedRepository`** (`backend/src/access/`), which merges the owner filter derived from the request's `AccessContext`. No method accepts an owner from the caller. Unscoped access (cross-owner jobs, admin under a support grant) uses separately named methods (`findAcrossOwnersForJob`) that are reviewed as such. |
| **AR-13** | `AccessContext` is built on the server from the authenticated account's **current** memberships and links on every request (BR-002-11, BR-002-15) — never from an id in the path, query or body, and never cached across requests. |
| **AR-14** | A record the caller may not access returns the same `404` as a missing one (BR-002-12). Services raise `NotFound`, never `Forbidden`, for owned records. |
| **AR-15** | Plan-limit checks and the write they guard happen atomically — a conditional update or a transaction — so concurrent requests cannot exceed the limit (BR-002-13). |
| **AR-16** | A collection is owned exactly when its schema has an `ownerId` path. The isolation suite enumerates the registered Mongoose models and fails on any model with `ownerId` and no isolation spec, and on any model without it that is not explicitly marked public (TS-14). |

## 5. Money and precision

A float reaching a money field corrupts data silently and permanently.

| | |
|---|---|
| **AR-17** | Money is never a JS `number`. In MongoDB it is `Decimal128`; in code it is a `Decimal` (`decimal.js`); over JSON it is a **string** (`"1234.56"`). The DTO layer converts at the edge. |
| **AR-18** | Percentages and rates (ITBI, commission, ROI) are `Decimal` too. A ratio computed in `number` and multiplied into money is the same bug one step removed. |
| **AR-19** | Rounding happens once, at the end of a calculation or at display, to 2 decimal places with `ROUND_HALF_EVEN` unless a spec states otherwise. Intermediate values keep full precision. |
| **AR-20** | Stripe amounts are integer centavos at the Stripe adapter only (AR-10); the conversion lives there and nowhere else. |
| **AR-21** | Display formatting (`R$ 1.234,56`, SPEC-003 BR-003-19) lives in one shared formatter on the frontend. Never `toFixed`, never inline `toLocaleString`. |

## 6. Time

SPEC-003 BR-003-23 to BR-003-28 put every date the product shows, accepts or schedules in Brasília time.

| | |
|---|---|
| **AR-22** | Instants are stored as UTC `Date`. Calendar dates with no time (journey closing date, auction date from the Caixa list) are stored as `YYYY-MM-DD` strings, never as midnight UTC. |
| **AR-23** | All zone conversion uses `@date-fns/tz` with the IANA zone `America/Sao_Paulo`, never a fixed offset (BR-003-28). One shared module per side owns the zone constant and the formatters. |
| **AR-24** | "Now" is injected. Services take a `Clock` provider; `domain/` takes the time as an argument. No `new Date()` in business logic. This is what makes deadlines, grace periods and retention testable. |
| **AR-25** | Cron expressions set `timeZone: 'America/Sao_Paulo'` explicitly (BR-003-27). |

## 7. Database conventions

| | |
|---|---|
| **AR-26** | Collections are plural `camelCase` (`savedFilters`); fields `camelCase`. Every schema has `timestamps: true`. |
| **AR-27** | Every query path a list screen or job uses has an index, declared in the schema next to the fields. Owned collections index the owner first: `{ ownerType: 1, ownerId: 1, <filter>: 1 }`. |
| **AR-28** | Schema changes are **expand/contract**: add the new field and deploy code that reads both shapes, backfill, then remove the old shape in a later release. Never a breaking shape change in one deploy. |
| **AR-29** | Backfills and data reshapes are versioned migration scripts in `backend/src/migrations/`, forward-only, idempotent, run as a gated step before the new code starts (DV-34). Never a one-off script run from a laptop. |
| **AR-30** | History collections (journey history, admin access log, SPEC-002 BR-002-17/BR-002-27) are append-only: the repository exposes no update or delete for them. |
| **AR-31** | Deleting personal data follows SPEC-010: the account is closed at once, and personal data is deleted or anonymised by a scheduled job within the retention window. Code never hard-deletes an owned record inline in a request handler. |

## 8. API surface

| | |
|---|---|
| **AR-32** | REST under `/api`, resources plural and kebab-case (`/api/saved-filters`). JSON bodies `camelCase`. |
| **AR-33** | Every endpoint is described with `@nestjs/swagger` decorators on the controller and DTOs. The OpenAPI document served at `/api/docs` (non-production only) **is** the API reference — there is no hand-written route table. |
| **AR-34** | Every request body and query is a DTO validated by the global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`). No `@Body() body: any`. |
| **AR-35** | List endpoints are paginated (`page`, `pageSize`, max 100) and return `{ items, total, page, pageSize }`. An unbounded list is a performance and a privacy bug. |
| **AR-36** | Responses are mapped from the document to a response DTO explicitly. Returning a Mongoose document leaks every field, including the ones added later. |

## 9. Errors

| Category | Handling |
|---|---|
| **Expected business outcomes** — plan limit reached, journey read-only, invalid phase transition | Thrown as a `DomainError` with a stable code. Mapped to HTTP by one exception filter. |
| **Faults** — database unreachable, provider 500, bug | Thrown as-is. The filter logs them, reports to Sentry and answers a generic `500`. |

| | |
|---|---|
| **AR-37** | `DomainError` carries a **stable code** and structured context — `{ code: 'PLAN_LIMIT_REACHED', limit: 5 }` — never a user-facing sentence. Codes are `UPPER_SNAKE_CASE` and listed in one catalogue (`backend/src/common/errors/codes.ts`). |
| **AR-38** | One global exception filter maps codes to HTTP status and the response shape `{ code, context }`. Controllers and services never build `HttpException`s for business outcomes. |
| **AR-39** | The frontend turns the code into pt-BR text through next-intl (`errors.PLAN_LIMIT_REACHED`). A code with no catalogue entry fails a frontend test. |
| **AR-40** | Error context never carries personal or client data (SPEC-002 BR-002-28, SC-15). Ids and counts only. |

## 10. Configuration

| | |
|---|---|
| **AR-41** | Configuration is read through `@nestjs/config` with a Zod schema validated **at boot**. An invalid or missing required value exits non-zero; there is no silent fallback for a secret. |
| **AR-42** | `process.env` is read only in the config module (backend) and `frontend/lib/env.ts` (frontend). Everywhere else injects typed config. |
| **AR-43** | Business settings the specs call configurable (retention periods, Caixa request budget, plan limits, calculator defaults) are typed settings with defaults, not constants scattered in code (SPEC-010 BR-010-24). |
| **AR-44** | Every variable is listed in the package's `.env.example` with a comment. Adding a variable without updating it fails review. |

## 11. Observability

| | |
|---|---|
| **AR-45** | Logging uses NestJS `Logger` (`private readonly logger = new Logger(ClassName.name)`), backed by `nestjs-pino` for structured JSON. **Never `console.*`** — lint-enforced (DV-11). `debug` for diagnostics (queries, cache hits), `log` for operational events, `warn`/`error` for what someone must look at. |
| **AR-46** | Every log line carries a request or job correlation id. A user appears only as a hashed id — never an email, name, phone or CPF (SC-15). |
| **AR-47** | Sentry runs on backend and frontend with request bodies, headers, cookies and query strings scrubbed (`sendDefaultPii: false` plus a `beforeSend` scrubber). Sentry captures them by default, which would break SPEC-002 BR-002-28 on day one. |
| **AR-48** | `GET /api/health` reports database reachability and the outcome and age of the last Caixa import. It is what the availability probe (SPEC-003 BR-003-02) and the deploy health check use. |

## 12. Frontend structure

| | |
|---|---|
| **AR-49** | Routes in `frontend/app/`; shared UI in `frontend/app/components/` following DESIGN.md's layers; data-fetching helpers and formatters in `frontend/lib/`. |
| **AR-50** | Server components by default. `'use client'` only for components that need state, effects or browser APIs, and as deep in the tree as possible. |
| **AR-51** | Authorization is enforced by the backend (SPEC-002 BR-002-10). Frontend guards (`RequireAuthentication`, `RequireRole`) are UX only — never the reason something is safe. |
| **AR-52** | All user-facing text goes through next-intl with the pt-BR catalogue (DS-20). Auction vocabulary is Caixa's (*modalidade*, *edital*, *matrícula*, *arremate*, SPEC-003 BR-003-18). |

## 13. Data flows worth knowing

**Caixa import (SPEC-004).** Daily list download → parse (`domain/`) → validate → upsert with change detection → Import Run record. Detail-page enrichment runs separately, under a daily budget (pages per day, concurrency, pause), refreshes pages on a rolling basis, and **stops the run on any block or challenge** without trying to get around it (BR-004-18, BR-004-20, SC-24).

**Files (SPEC-017).** Upload and download through R2 presigned URLs, issued per request after an authorization check and valid for 60 seconds (BR-002-08, BR-002-09). Keys are random; nothing about the owner or the file's content appears in a key.

**Payments (SPEC-012).** Checkout session created by the backend; plan state changes only on a verified Stripe webhook, processed idempotently by event id (SC-11).
