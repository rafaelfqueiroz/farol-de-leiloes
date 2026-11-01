# Engineering Guidelines

How the [specs](https://github.com/rafaelfqueiroz/farol-de-leiloes/wiki/Specs) get built. Six documents, each answering a different question.

The guidelines live in the repository, next to the code they govern. The **[PRD](https://github.com/rafaelfqueiroz/farol-de-leiloes/wiki)** (Portuguese) and the **[specs](https://github.com/rafaelfqueiroz/farol-de-leiloes/wiki/Specs)** (English) live in the wiki; work is tracked on the **[project board](https://github.com/users/rafaelfqueiroz/projects/4)**.

| Doc | Answers |
|---|---|
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | How the system is shaped — topology, layering, ownership, money, time, database, API, errors, config, observability |
| **[DEVELOPMENT.md](DEVELOPMENT.md)** | How to work — dependencies, code conventions, agent rules, lifecycle, git and PRs, CI/CD, ADRs, definition of done |
| **[TESTING.md](TESTING.md)** | How correctness is proven — test types, critical modules, isolation gate, coverage, lint/format and where each check runs |
| **[SECURITY.md](SECURITY.md)** | How the system stays safe and lawful — authentication, authorization, input/output, supply chain, AI, scraping, LGPD |
| **[DESIGN.md](DESIGN.md)** | How the interface is built — brand, tokens, theming, colour, typography, layout, components, page frames, text, accessibility. Visual reference: the [design system artifact](https://claude.ai/artifact/A4Y69knqEHAqZfQKPLrKCf) (private to the owner until shared) |

Rules are numbered `AR-nn` (architecture), `DV-nn` (development), `TS-nn` (testing), `SC-nn` (security) and `DS-nn` (design). Cite them from code comments, commits and PRs the same way spec rules (`BR-NNN-nn`) are cited (DV-14). Numbers are never reused; a rule that is withdrawn is struck through, not renumbered.

Alongside: [`docs/adr/`](../adr/README.md) for technical decisions, [`docs/runbooks/`](../runbooks/README.md) for when things go wrong.

## The stack, in one table

| | |
|---|---|
| Language | TypeScript, strict, Node 24 LTS pinned everywhere |
| Backend | NestJS · Mongoose · MongoDB 7 |
| Frontend | Next.js App Router · React · MUI · next-intl (pt-BR) |
| Money / time | `Decimal128` + `decimal.js` · `date-fns` + `@date-fns/tz` (Brasília) |
| Integrations | Stripe · OpenAI · Cloudflare R2 · SMTP · Google sign-in · Caixa |
| Observability | `nestjs-pino` · Sentry (scrubbed) · `/api/health` |
| Testing | Jest + Testcontainers (backend) · Vitest + Testing Library (frontend) · Playwright |
| Quality gates | ESLint · Prettier · husky (pre-commit lint-staged, pre-push `check` per changed package) · GitHub Actions · CodeQL — hooks and lint in place (#29); CI pending #33 |
| Package manager | npm, one lockfile per package |
| Hosting | Undecided — deploy gated off (BL-001) |

## Five rules that carry the most weight

Everything else is convention. These are the ones where a violation causes damage that is expensive or impossible to undo:

1. **Every access to an owned collection goes through the owner-scoped repository** (AR-12), and every owned collection has an isolation test the CI enumerates (TS-13, TS-14). A missing filter returns your own rows in development and looks correct.
2. **Money is never a JS `number`** (AR-17–AR-20). A float in a money path corrupts data silently and permanently.
3. **No personal or client data in logs, errors, Sentry or AI prompts** (SC-15, SC-22). Once it is there, it is everywhere the logs go.
4. **`domain/` imports no framework** (AR-05). It is what keeps the calculations testable to 100% branch coverage (TS-24) — and it is enforced by lint, not discipline.
5. **Caixa is scraped politely and undisguised** (SC-24). Evasion is a legal and reputational risk to the whole product, settled by D-50.

## What blocks a merge

| Check | Blocking |
|---|---|
| Typecheck · lint · format, both packages | ✅ |
| Unit, service and component tests | ✅ |
| Integration tests on real MongoDB | ✅ |
| **Isolation tests — every owned collection** | ✅ |
| Coverage — 100% branch on critical modules, 80% overall | ✅ |
| E2E journeys, desktop + 360 px, with axe | ✅ |
| Structural checks — Node pin, tokens in both schemes, env example | ✅ |
| `npm audit` high+ · CodeQL high+ | ✅ |
| Build, both packages | ✅ |
| Performance budgets | Release candidates (SPEC-003 BR-003-10), deferred (BL-002) |

## Deferred work

Decided, not built, each with the trigger that ends the deferral.

| ID | Item | Trigger |
|---|---|---|
| [BL-001](https://github.com/rafaelfqueiroz/farol-de-leiloes/issues/40) | Hosting and deploy target (app, MongoDB, backups); turn on `deploy.yml` (DEVELOPMENT §12) | Before the first external user |
| BL-002 | Performance harness: reference workload + budgets on release candidates (TESTING §10), planned in [#3](https://github.com/rafaelfqueiroz/farol-de-leiloes/issues/3) | With BL-001, before the first release candidate |
| [BL-003](https://github.com/rafaelfqueiroz/farol-de-leiloes/issues/38) | Design-system code — theme folder, patterns, logo files, migration of screens. The brand itself is decided (DESIGN v1.1, DS-01–DS-30) | Second PR of #38 |

## Amendments to spec issue plans

The spec issues were written before these guidelines. Where an implementation plan disagrees with a guideline, the guideline wins:

| Issue | Plan says | Guideline |
|---|---|---|
| [#3](https://github.com/rafaelfqueiroz/farol-de-leiloes/issues/3) SPEC-003 | `dayjs` with `utc`/`timezone` plugins | `date-fns` + `@date-fns/tz` on both sides (AR-23) |
| [#1](https://github.com/rafaelfqueiroz/farol-de-leiloes/issues/1), [#2](https://github.com/rafaelfqueiroz/farol-de-leiloes/issues/2), [#3](https://github.com/rafaelfqueiroz/farol-de-leiloes/issues/3) | Update `docs/architecture/overview.md`, `docs/apps/*`, `docs/development/guide.md` | Those docs are removed. Update these guidelines and the OpenAPI decorators instead (DV-29, DV-30) |
| [#2](https://github.com/rafaelfqueiroz/farol-de-leiloes/issues/2) SPEC-002 | Isolation suite and owner-scoped repository | Unchanged — codified as AR-11–AR-16 and TS-13–TS-18 |
