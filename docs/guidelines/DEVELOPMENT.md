# Development Guidelines

| | |
|---|---|
| **Status** | Draft v1.0 |
| **Companion docs** | [ARCHITECTURE.md](ARCHITECTURE.md), [TESTING.md](TESTING.md), [SECURITY.md](SECURITY.md) |

How to work: dependencies, code conventions, the lifecycle of a change, git and PRs, CI/CD, ADRs and the definition of done. Rules are numbered `DV-nn`.

## 1. Canonical dependencies

One approved choice per concern. Adding a dependency that overlaps one of these needs an ADR (§10).

| Concern | Backend | Frontend |
|---|---|---|
| Framework | `@nestjs/*` | `next`, `react` |
| Data access | `mongoose`, `@nestjs/mongoose` | — (never; AR-02) |
| Decimals | `decimal.js` | `decimal.js` |
| Dates | `date-fns`, `@date-fns/tz` | `date-fns`, `@date-fns/tz` |
| Validation | `class-validator`, `class-transformer` (DTOs); `zod` (config) | `zod` |
| Auth | `@nestjs/passport`, `passport-jwt`, `passport-google-oauth20`, `bcrypt` | — |
| Rate limiting | `@nestjs/throttler` | — |
| HTTP headers | `helmet` | `next.config.ts` headers |
| API docs | `@nestjs/swagger` | — |
| UI | — | `@mui/material`, `@mui/icons-material`, `@mui/x-date-pickers` |
| i18n | — | `next-intl` |
| Logging / errors | `nestjs-pino`, `@sentry/nestjs` | `@sentry/nextjs` |
| Payments | `stripe` | `@stripe/stripe-js` |
| Files | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` (R2) | — |
| Scraping | `puppeteer`, `cheerio` | — |
| Tests | `jest`, `ts-jest`, `@testcontainers/mongodb`, `supertest` | `vitest`, `@testing-library/react`, `vitest-axe`, `@playwright/test`, `@axe-core/playwright` |
| Lint / format | `eslint`, `typescript-eslint`, `prettier` | `eslint`, `eslint-config-next`, `prettier` |
| Git hooks | `husky`, `lint-staged` (repository root) | |

**Not used:** `dayjs`, `moment` (replaced by date-fns), Tailwind (DS-23), `lodash` (native equivalents), `puppeteer-extra-plugin-stealth` and any other bot-detection evasion (SC-24), an HTTP client wrapper (native `fetch`), a second ORM.

## 2. TypeScript

| | |
|---|---|
| **DV-01** | `strict: true` on both packages, with nothing relaxed (`noImplicitAny` stays on), plus `noUncheckedIndexedAccess`, `noImplicitOverride` and `noFallthroughCasesInSwitch`. |
| **DV-02** | `any` is banned by lint (`@typescript-eslint/no-explicit-any: error`). `unknown` plus validation is the escape hatch. A genuinely necessary `any` carries an `eslint-disable-next-line` with the reason. |
| **DV-03** | No non-null assertions (`!`). If a value can be absent, handle the absence. |
| **DV-04** | Inference inside functions; explicit types at boundaries — exported service methods, repository methods, `domain/` functions, controller handlers and React component props. |

## 3. Runtime and packages

| | |
|---|---|
| **DV-05** | **Node 24 LTS, one exact version, pinned everywhere**: `.node-version` at the root and in each package, `engines.node` in both `package.json`s, the Docker images by tag, and `node-version-file` in CI. A structural test fails when any of them drifts. To upgrade, change all of them in one PR. |
| **DV-06** | npm, one lockfile per package (`backend/`, `frontend/`), always committed. CI installs with `npm ci`. A PR that changes `package.json` without the lockfile fails CI. |

## 4. Naming and structure

| | |
|---|---|
| **DV-07** | Backend files are `kebab-case` with the Nest role suffix: `journey-phase.service.ts`, `create-journey.dto.ts`, `journey.schema.ts`. React components are `PascalCase.tsx`; other frontend files `kebab-case.ts`. |
| **DV-08** | Directories are domain concepts (`journeys/`, `viability/`), lowercase with hyphens. Never `services/`, `helpers/`, `utils/` at module level. |
| **DV-09** | Frontend imports use the `@/` alias. Backend imports stay relative inside a module; another module is reached only through its exported service (AR-09). |
| **DV-10** | No barrel files (`index.ts` re-exports) except a module's public surface. They hide the import graph the boundary lint depends on. |
| **DV-11** | Never `console.*` — use NestJS `Logger` (AR-45). Enforced by ESLint `no-console: error` in the backend; in the frontend, client logging goes to Sentry. |
| **DV-12** | Prettier owns formatting (2 spaces, semicolons, single quotes, trailing commas, 100 columns). Nobody formats by hand and no review comment is about formatting. |

## 5. Comments

| | |
|---|---|
| **DV-13** | Comment **why**, not what. |
| **DV-14** | Code implementing a spec or guideline rule cites it: `// SPEC-012 BR-012-28: 10-day grace, then read-only`, `// AR-14: same 404 as a missing record`. This is how a reader finds the reasoning without hunting. |
| **DV-15** | Non-obvious calculations (viability, settlement, phase averages) carry a worked example in a comment. |
| **DV-16** | No commented-out code. No `TODO` without an issue link: `// TODO(#123): ...`. |

## 6. Local setup and scripts

```bash
cp backend/.env.example backend/.env           # fill in what you need
cp frontend/.env.example frontend/.env.local
# MongoDB 7 on localhost:27017 — a local install or `docker run -d -p 27017:27017 mongo:7`
(cd backend && npm ci && npm run start:dev)    # API on :3000
(cd frontend && npm ci && npm run dev)         # web on :3001
```

Both packages expose the same script names:

| Script | Does |
|---|---|
| `typecheck` | `tsc --noEmit` |
| `lint` / `lint:fix` | ESLint |
| `format` / `format:check` | Prettier |
| `test` | Unit tests (backend: unit + `domain/`; frontend: Vitest) |
| `test:integration` | Backend only — Testcontainers MongoDB (TESTING §2) |
| `test:isolation` | Backend only — the isolation gate (TESTING §4) |
| `test:e2e` | Frontend only — Playwright against the Compose stack |
| `test:cov` | Tests with the coverage gate (TESTING §7) |
| `check` | `typecheck` + `lint` + `format:check` + `test` — **run before pushing** |

### Rules for AI coding agents

| | |
|---|---|
| **DV-17** | Agents may run the package scripts above on the host: `check`, `test`, `test:integration`, `test:isolation`, `test:cov`. Databases always come from containers (Testcontainers picks random ports, so they never collide with the developer's own). |
| **DV-18** | Agents never start the applications on the host (`start:dev`, `dev`, `start`) — the developer runs them on the fixed ports. E2E runs through `test:e2e`, which brings up its own Compose stack. |
| **DV-19** | Agents never read, print or edit `.env` / `.env.local`, and never point a test at the developer's local database. |
| **DV-20** | An agent's work is not done until `npm run check` passes in every package it touched, and the docs it affects are updated in the same PR (§9). |

## 7. Software development lifecycle

Product intent lives in the [wiki](https://github.com/rafaelfqueiroz/farol-de-leiloes/wiki): the PRD in Portuguese, the specs (`SPEC-NNN`) in English. Implementation is tracked on the [project board](https://github.com/users/rafaelfqueiroz/projects/4) — one issue per spec, titled `SPEC-NNN — Title`, labelled `spec` and its milestone (`M0`–`M8`).

```
PRD (wiki) ─► Spec (wiki, BR/AC/DL) ─► Issue + implementation plan (board)
   ─► branch ─► tests first for domain rules ─► code ─► npm run check
   ─► PR (template, rules cited) ─► CI gates ─► self-review ─► squash-merge
   ─► board updated, AC ticked ─► (deploy, once enabled)
```

An issue that adds a page or changes a page's layout also needs a **page frame approved by the product owner on the issue before the branch is cut** (DS-30); the PR links it.

| Stage | Owner of the truth | What changes there |
|---|---|---|
| Product decision | PRD `D-nn`, `Questões-em-Aberto-e-Decisões` | A new decision or an answered question |
| Behaviour | Spec `BR-NNN-nn`, `AC`, `DL-NNN-nn` | A rule changes → the spec changes first, then the code |
| Plan and progress | The spec's issue | Implementation plan, checklist, links to PRs |
| Technical decision | ADR (§10) | A choice the specs did not anticipate |
| How we build | These guidelines | Through a PR like any other change |

| | |
|---|---|
| **DV-21** | Code never silently disagrees with a spec. If implementation shows a rule is wrong, the spec is amended (with a Decision Log entry) in the same cycle, and the PR links the amendment. |
| **DV-22** | Domain rules are written test-first: the test states the rule with a hand-computed expectation (TS-04), then the code makes it pass. |
| **DV-23** | Work that is out of scope for the current PR becomes an issue on the board, not a `TODO` and not a silent expansion of the PR. |

## 8. Git and pull requests

**Trunk-based.** `main` is always releasable. Branches live a day or two and are squash-merged.

| | |
|---|---|
| **DV-24** | Branch names: `feat/spec-011-office-invites`, `fix/spec-004-bom-header`, `chore/…`, `docs/…`, `refactor/…`. Include the spec id when one applies. |
| **DV-25** | [Conventional Commits](https://www.conventionalcommits.org/): `feat(journeys): block writes on read-only offices`. The squash-merge title follows the same format. |
| **DV-26** | The commit/PR body names the rules implemented: `Implements SPEC-002 BR-002-30.` Breaking API, schema or config changes carry `BREAKING CHANGE:` in the footer. |
| **DV-27** | Every change goes through a PR — self-reviewed when solo. `main` is protected: PR required, required status checks green, branch up to date, linear history, no force-push, no direct push. |
| **DV-28** | Never commit `.env` files, real personal data, production exports, or anything copied from a user's account (SC-32). |

The PR template lives at [`.github/pull_request_template.md`](../../.github/pull_request_template.md). A PR:

- links the spec issue (`Closes #N` only when it completes the spec; otherwise `Part of #N`);
- lists the BR/AC it implements and ticks the AC it satisfies;
- says how it was verified;
- includes screenshots in light and dark, desktop and 360 px, for UI changes, and links the approved frame for a new or changed page (DS-30);
- updates the guidelines or `README`s it makes stale.

## 9. Documentation

| | |
|---|---|
| **DV-29** | A PR that changes behaviour a doc describes updates that doc in the same PR: these guidelines, the package `README`s, `.env.example`, the OpenAPI decorators (AR-33). |
| **DV-30** | The API reference is the generated OpenAPI document (AR-33); the system map is ARCHITECTURE §2 and §13. No other hand-maintained reference docs. |

## 10. ADRs

Spec Decision Logs record **product** decisions. ADRs record **technical** decisions the specs did not anticipate. They live in [`docs/adr/`](../adr/README.md) as `NNN-short-title.md`.

| | |
|---|---|
| **DV-31** | Write an ADR when a choice is hard to reverse, contradicts a guideline here, adds an overlapping dependency (§1), or is one a future reader would otherwise reopen. |
| **DV-32** | Never edit a decided ADR. Supersede it with a new one and link both ways. |

## 11. Runbooks

[`docs/runbooks/`](../runbooks/README.md) holds procedures for when something is going wrong: ordered steps, what **not** to do, and their own known gaps. The first is [incident-response.md](../runbooks/incident-response.md) — any unauthorised access, loss or disclosure of personal data (SC-31).

## 12. CI/CD

GitHub Actions. The repository is public, so minutes are not the constraint — the full suite runs on every PR and on `main`.

### `ci.yml` — every PR and every push to `main`

| Job | Steps | Blocking |
|---|---|---|
| `backend-static` | `npm ci` · typecheck · lint · format check | ✅ |
| `backend-test` | unit + `domain/` tests with coverage gate | ✅ |
| `backend-integration` | Testcontainers MongoDB: integration + **isolation** | ✅ |
| `backend-build` | `nest build` | ✅ |
| `frontend-static` | `npm ci` · typecheck · lint · format check | ✅ |
| `frontend-test` | Vitest components + axe, coverage gate | ✅ |
| `frontend-build` | `next build` | ✅ |
| `e2e` | Compose stack (API + web + MongoDB, stubbed providers) · Playwright desktop + mobile · axe | ✅ |
| `audit` | `npm audit --audit-level=high` in both packages | ✅ |
| `structural` | Node version pinned everywhere (DV-05) · design tokens in both schemes (DS-05) · `.env.example` covers the config schema (AR-44) | ✅ |
| `codeql` | GitHub CodeQL for JavaScript/TypeScript | ✅ on high/critical |

`concurrency: cancel-in-progress` on PRs, so a superseded push stops. Every job above is a **required status check** on `main` (DV-27).

### `deploy.yml` — gated until a target exists

**There is no deploy target yet** (BL-001). The workflow exists so the image build is proven on every push to `main`, long before there is anywhere to send it:

```
build images (backend, frontend) ─► tag with commit SHA ─► push to GHCR
  ─► preflight: DEPLOY_ENABLED set?  ── no ─► skip quietly
                                      └─ yes, secrets missing ─► fail loudly
  ─► run migrations (gated) ─► roll out ─► GET /api/health ─► roll back image on failure
```

| | |
|---|---|
| **DV-33** | Images are tagged with the commit SHA. Rollback is redeploying a previous SHA, which only works because migrations are forward-only and expand/contract (AR-28). |
| **DV-34** | Migrations (AR-29) run as a separate, gated step **before** the new code starts. A failed migration aborts the deploy and leaves the running version untouched. |
| **DV-35** | Deploy secrets live in the GitHub `production` environment, not repository secrets. Runtime secrets live in the host's secret store, never in CI logs or images. |
| **DV-36** | `DEPLOY_ENABLED` is a repository variable separate from the secrets: unset, a missing secret is expected and the deploy skips; set, a missing secret is a fault and `preflight` fails. |

### `nightly.yml`

Dependency audit with the full advisory list, and — once BL-002 lands — the performance budgets of SPEC-003 against the reference workload.

## 13. Definition of done

A spec's issue is closed when:

- [ ] Every acceptance criterion is ticked and demonstrable
- [ ] Every business rule is implemented, or explicitly deferred with a note in the spec
- [ ] `npm run check` passes and CI is green, including coverage gates
- [ ] Every new owned collection has `ownerType`/`ownerId` and its isolation spec (AR-11, AR-16, TS-14)
- [ ] Migrations reviewed, idempotent and expand/contract (AR-28, AR-29)
- [ ] No personal or client data in logs, errors or Sentry (SC-15)
- [ ] User-facing text in pt-BR through next-intl, with Caixa vocabulary (DS-20)
- [ ] Screens work at 360 px, in light and dark, by keyboard, and pass axe (DS-13, DS-21)
- [ ] New or re-laid-out pages match their approved frame (DS-30)
- [ ] Endpoints documented in OpenAPI (AR-33)
- [ ] LGPD data inventory updated for any new personal data field (SC-25)
- [ ] ADR written for any technical decision the specs did not cover
- [ ] Docs updated (DV-29)
