# CLAUDE.md — Farol dos Leilões

Search, analysis and acquisition management for Caixa real-estate auctions: public search, AI-assisted search, favorites and reminders, advisor offices managing investors' acquisition journeys, and subscription plans.

- `backend/` — NestJS API on MongoDB (port 3000)
- `frontend/` — Next.js App Router with MUI (port 3001)
- Product: [PRD and specs](https://github.com/rafaelfqueiroz/farol-de-leiloes/wiki) (wiki) · work: [project board](https://github.com/users/rafaelfqueiroz/projects/4) · one issue per spec

## Guidelines — read before changing code

The rules live in [`docs/guidelines/`](docs/guidelines/README.md). Read the doc that governs the change before starting it, and cite rule ids (`AR-`, `DV-`, `TS-`, `SC-`, `DS-`, and spec `BR-NNN-nn`) in code comments, commits and PRs.

| Doc | Read it when |
|---|---|
| [ARCHITECTURE.md](docs/guidelines/ARCHITECTURE.md) | Adding a module, collection, endpoint, job, config value, or touching money or dates |
| [DEVELOPMENT.md](docs/guidelines/DEVELOPMENT.md) | Always — conventions, agent rules, git/PR flow, CI, definition of done |
| [TESTING.md](docs/guidelines/TESTING.md) | Writing or changing any behaviour (i.e. always) |
| [SECURITY.md](docs/guidelines/SECURITY.md) | Auth, permissions, owned data, payments, uploads, AI, scraping, any personal data |
| [DESIGN.md](docs/guidelines/DESIGN.md) | Any frontend change; a new or re-laid-out page needs an approved frame first (DS-30) |

Technical decisions: [`docs/adr/`](docs/adr/README.md). Incidents: [`docs/runbooks/`](docs/runbooks/README.md).

## Five rules that carry the most weight

1. Owned data only through the owner-scoped repository, with an isolation test (AR-12, TS-13).
2. Money is never a JS `number` — `Decimal128` / `decimal.js` / strings over JSON (AR-17).
3. No personal or client data in logs, errors, Sentry or AI prompts (SC-15, SC-22).
4. `domain/` imports no framework; critical modules at 100% branch coverage (AR-05, TS-24).
5. Caixa is scraped politely and undisguised — no stealth or evasion (SC-24).

## Agent rules (DEVELOPMENT §6)

- Run package scripts on the host: `npm run check`, `test`, `test:integration`, `test:isolation`, `test:cov`. Databases come from Testcontainers only (DV-17).
- **Never start the apps on the host** (`start:dev`, `dev`, `start`) — the developer runs them; E2E uses `npm run test:e2e` (DV-18).
- Never read, print or edit `.env` files; never touch the developer's local database (DV-19).
- Logging: NestJS `Logger` only, never `console.*` (AR-45).
- Done means `npm run check` passes in every package touched and affected docs are updated in the same PR (DV-20, DV-29). Never bypass hooks with `--no-verify` (TS-30).
- Out-of-scope findings become issues on the board, not silent PR growth (DV-23).

## Context Engineering (Main Agent Discipline)

The main agent is an **orchestrator**, not a worker.

**Main agent role:** Coordinate files, spawn sub-agents, process
summaries, communicate with the user, elaborate plans.

**Main agent NEVER:** Explores the codebase broadly, implements code
changes, runs builds/tests, processes large command output.
All of these get delegated to sub-agents.

### Sub-agent Communication Protocol

- Every prompt ends with: "Return a structured summary with these exact fields:"
- Never ask a sub-agent to "return everything"
- Target 10-20 lines of actionable info per result
- Chain sub-agents: pass only relevant fields between them

#### Required Response Fields by Task Type

**Code exploration / research agents:**
- `files_changed`: List of file paths read or relevant to findings
- `summary`: 1-3 sentence description of what was found
- `key_findings`: Bulleted list of actionable facts (max 10)
- `blockers`: Any issues, missing dependencies, or ambiguities found
- `suggested_approach`: Recommended next step based on findings

**Implementation agents (write code):**
- `files_changed`: List of file paths created or modified
- `changes_summary`: 1-line description per file changed
- `tests_needed`: Whether new/updated tests are required and for what
- `dependencies_added`: Any new packages installed (name + version)
- `migration_needed`: Whether DB schema changes require migration steps
- `breaking_changes`: Any API or interface changes that affect other modules

**Test / validation agents:**
- `pass_fail`: PASS or FAIL
- `total_tests`: Number of tests run
- `failures`: List of failing test names with 1-line error description
- `coverage_delta`: Whether coverage increased/decreased (if available)
- `suggested_fixes`: For failures, recommended fix per failing test

**Build / lint agents:**
- `pass_fail`: PASS or FAIL
- `errors`: List of errors with file:line and 1-line description
- `warnings`: Count of warnings (list only if < 10)
- `suggested_fixes`: Recommended fix per error

### Model Routing Table

Assign sub-agents to the optimal model based on task complexity:

| Task | Model | Rationale |
|------|-------|-----------|
| Architectural decisions and system design | Opus | Requires deep reasoning about trade-offs and dependencies |
| Complex multi-file refactoring | Opus | Needs holistic understanding of codebase relationships |
| Debugging hard-to-reproduce issues | Opus | Requires hypothesis generation and multi-step reasoning |
| Security audits and vulnerability analysis | Opus | Needs thorough analysis of attack vectors |
| New feature planning and design | Opus | Requires weighing multiple design approaches |
| Standard feature implementation | Sonnet | Well-defined scope, clear patterns to follow |
| Test writing and test coverage | Sonnet | Follows established patterns, moderate complexity |
| API endpoint implementation | Sonnet | Follows NestJS conventions, well-scoped |
| Frontend page/component creation | Sonnet | Follows React/Next.js patterns, moderate reasoning |
| Code review and PR analysis | Sonnet | Needs context understanding but follows checklists |
| Bug fixes with clear reproduction | Sonnet | Scoped problem, moderate reasoning needed |
| Database schema changes | Sonnet | Needs understanding of relationships but follows patterns |
| Documentation updates | Haiku | Straightforward writing from existing code |
| Simple fixes (lint, format, typos, CSS) | Haiku | Mechanical changes, minimal reasoning |
| Dependency updates and version bumps | Haiku | Follow changelogs, update configs |
| Code search and exploration | Haiku | Fast file/pattern matching, low reasoning |
| Environment and config changes | Haiku | Small, well-defined edits |
| Renaming and find-replace operations | Haiku | Mechanical, pattern-based changes |
| Commit message and changelog generation | Haiku | Summarization from diff, low complexity |
