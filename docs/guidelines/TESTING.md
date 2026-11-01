# Testing Guidelines

| | |
|---|---|
| **Status** | Draft v1.0 |
| **Companion docs** | [ARCHITECTURE.md](ARCHITECTURE.md), [DEVELOPMENT.md](DEVELOPMENT.md), [SECURITY.md](SECURITY.md) |

How correctness is proven: what to test, with what, where tests live, when each check runs, and what blocks a merge. Rules are numbered `TS-nn`.

## 1. Philosophy

Effort goes where a bug does real damage. In this product that is three places:

1. **The numbers.** A viability figure, a settlement or a holdings total that is subtly wrong gets trusted and acted on — someone bids on a property because of it. A crash gets reported; a wrong number does not.
2. **The boundary between owners.** An office seeing another office's client, or learning that the client exists, is the failure SPEC-002 exists to prevent. It is **invisible in single-user development**: a query missing its owner filter returns your own rows and looks correct.
3. **Personal data leaving where it belongs** — into logs, Sentry, exports or an AI prompt.

**Two things cannot be tested against a mock** and are tested against a real MongoDB (Testcontainers): ownership scoping, and `Decimal128` ⇄ `Decimal` round-tripping.

**Time is an input.** Grace periods, retention, reminders, "today" in Brasília: none is testable without controlling the clock, which is why `Clock` is injected (AR-24).

## 2. Test types

| Type | Runs against | Tool | Location | Speed |
|---|---|---|---|---|
| **Domain unit** | Nothing — pure functions in `domain/` | Jest | next to source, `*.spec.ts` | ms |
| **Service unit** | Fakes of ports and repositories | Jest | next to source, `*.spec.ts` | ms |
| **Integration** | Real MongoDB (Testcontainers `mongo:7`), Nest testing module, `supertest` | Jest | `backend/test/integration/` | seconds |
| **Isolation** | Real MongoDB, two or more owners, through the HTTP API | Jest | `backend/test/isolation/` | seconds |
| **Component** | jsdom, real theme, real pt-BR catalogue | Vitest + Testing Library + `vitest-axe` | next to source, `*.test.tsx` | ms |
| **E2E** | Full stack in Compose, providers stubbed | Playwright + `@axe-core/playwright` | `frontend/e2e/` | minutes |
| **Structural** | The repository itself (configs, tokens, versions) | Jest / Vitest | `backend/test/structural/`, `frontend/test/structural/` | ms |

| | |
|---|---|
| **TS-01** | Domain and service unit tests never touch a database or the network. If a domain rule needs a database to be tested, the layering is wrong (AR-05). |
| **TS-02** | Repository and isolation tests run against real MongoDB. Never mock Mongoose — mocking the database mocks away the owner filter being verified. |
| **TS-03** | Ports (AR-10) and repositories are faked with **hand-written fakes that implement the real interface**, not `jest.mock`. A fake breaks at compile time when the interface changes; a mock keeps passing. `jest.mock` is reserved for modules with no port (rare, and commented). |
| **TS-04** | No test uses the implementation's own output as its expectation. Expected values are computed by hand — the arithmetic written in a comment — or taken from an external authority. |
| **TS-05** | Every test is independent and order-agnostic. Each integration file uses its own database name on the shared container and drops it in `afterAll`; no test depends on another's data. |
| **TS-06** | Time is controlled: services get a fake `Clock`; `domain/` gets the time as an argument. No test sleeps, and no test passes or fails depending on the day it runs. |
| **TS-07** | No test reaches a live external system. Caixa is replayed from fixtures, Stripe/OpenAI/SMTP/R2 are fakes of their ports, and Google sign-in is stubbed. |

## 3. The critical modules

The `domain/` code listed in AR-06: viability calculator, match score and Radar, plan entitlements and limits, phase transitions and averages, cost and contribution settlement, holdings totals, and the Caixa parser and change detection.

| | |
|---|---|
| **TS-08** | Every business rule of the spec behind a critical module has at least one test, named after the rule: `it('BR-014-07: ITBI is charged on the higher of bid and appraisal')`. A rule with no test is a rule that is not implemented. |
| **TS-09** | Calculations are tested with hand-computed expectations, the arithmetic in a comment (TS-04), and at their edges: zero, missing optional inputs, maximum values, a single-cent remainder. |
| **TS-10** | Precision is tested adversarially: long sequences of costs and contributions with repeating decimals, asserting no drift against the hand total. This is the test that catches a `number` leaking into a money path (AR-17). |
| **TS-11** | Calendar logic is tested on its boundaries: 23:59 and 00:00 in Brasília vs UTC, month ends, 29 February anniversaries (SPEC-010 BR-010-19), and a rule-based zone rather than a fixed offset (SPEC-003 BR-003-28). |
| **TS-12** | The Caixa parser is tested on fixtures covering the awkward cases: BOM, metadata rows, reordered or missing columns, malformed prices, an empty list, and the bot-protection page — which must stop the run, not be parsed (SPEC-004 BR-004-20). |

## 4. Isolation tests — the blocking gate

| | |
|---|---|
| **TS-13** | Every owned collection has an isolation test. **This gate blocks merges** regardless of suite time. |
| **TS-14** | Coverage is enforced by a test that **enumerates the registered Mongoose models** and fails on any model with an `ownerId` path and no isolation spec, or without one and not explicitly marked public (AR-16). Never a hand-maintained list — it goes stale silently. |
| **TS-15** | Tests run at the **API surface**, not the repository: lists, details, counts, search, exports, notifications and file links. Leaks happen in aggregates and side channels, above where repository tests look. |
| **TS-16** | Standard shape: seed offices A and B and investors on each side with distinguishable data; as each persona of A, exercise every read path; assert nothing of B's appears — not in bodies, not in counts, not in error messages. |
| **TS-17** | A request for B's record by id returns exactly the response of a non-existent id (SPEC-002 BR-002-12). A request carrying B's owner id in the path, query or body acts on the caller's own context (BR-002-11). |
| **TS-18** | Access follows current state: after a member is removed or a link ends, the next request is refused (BR-002-15, BR-002-07). Cross-owner jobs deliver only to accounts entitled at delivery time (BR-002-29). |

## 5. Frontend components

| | |
|---|---|
| **TS-19** | Every shared component has a test that renders it **inside the real MUI theme (light and dark) and the real next-intl pt-BR catalogue** and runs an axe assertion. A stub catalogue would let a missing key ship as literal text. |
| **TS-20** | Tests assert what a user perceives — roles, labels, text, focus — via Testing Library queries (`getByRole` first). No snapshot tests of markup, no assertions on class names. |

`color-contrast` cannot be measured in jsdom; it is disabled in the component harness explicitly (not left as "incomplete") and covered by the token contrast test (DS-08) and E2E (TS-23).

## 6. E2E

Playwright covers the journeys where a break means the product is unusable — deliberately few, because they are slow:

1. Public search with filters → property page (SPEC-005)
2. Sign up with email, confirm, sign in; sign in with Google (stubbed) (SPEC-001)
3. Favorite a property, save a filter, set a reminder (SPEC-007)
4. Subscribe to a plan through Stripe test mode, stubbed at the network boundary (SPEC-012)
5. As an advisor: create a client and a journey, advance a phase; as the investor: see it read-only (SPEC-011, SPEC-016, SPEC-021)
6. Export my data and delete my account (SPEC-010)

The list grows with the milestones — each spec's issue says whether it adds a journey.

| | |
|---|---|
| **TS-21** | E2E asserts user-visible outcomes, not database state. Anything needing internal state is an integration test. |
| **TS-22** | No E2E test depends on a live external provider (TS-07). The Compose E2E stack wires the backend to fake adapters. |
| **TS-23** | Every journey runs on a desktop viewport and a **360 px** phone viewport (SPEC-003 BR-003-12), and runs axe on each page it visits (BR-003-14, BR-003-17). |

## 7. Coverage gates

| Scope | Threshold | Blocking |
|---|---|---|
| Critical `domain/` modules (AR-06) | **100% branch** | ✅ |
| Backend overall | **80% lines and branches** | ✅ |
| Frontend overall | **80% lines and branches** | ✅ |
| Isolation — every owned collection | **100%** (TS-14) | ✅ |

| | |
|---|---|
| **TS-24** | 100% on critical modules is **branch** coverage, not line. The edge cases — a zero, a missing rate, a closed journey — are branches; lines alone would pass while missing them. Thresholds are configured per path in `jest.config.ts`. |
| **TS-25** | Coverage is a floor, not a goal. A covered line proves execution, not correctness; TS-04's hand-computed expectations are what prove correctness. |
| **TS-26** | Do not chase coverage on adapters by testing framework behaviour. Adapters are covered by integration tests that exercise real behaviour. |

## 8. Fixtures and data

| | |
|---|---|
| **TS-27** | **No real personal data in the repository** — not in fixtures, seeds, snapshots, screenshots or bug reports. Names, emails, phones and CPFs in tests are generated and obviously fake (SC-32). |
| **TS-28** | Caixa public pages and lists may be captured as fixtures, trimmed to what the test needs, under `backend/test/fixtures/caixa/`. They contain no personal data; if one ever does (an occupant's name in a description), it is redacted before commit. |
| **TS-29** | Test data is built with builders with sensible defaults (`aJourney().forOffice(a).inPhase('REGULARIZAR')`), so a test states only what it cares about. |

## 9. Static checks — what runs, when, where

| Check | Pre-commit (husky + lint-staged) | Pre-push (husky, changed packages only) | `npm run check` (local) | CI on PR and `main` |
|---|---|---|---|---|
| Prettier | `--write` on staged files | `format:check` | `format:check` | `format:check` ✅ |
| ESLint | `--fix` on staged files | `lint` | `lint` | `lint` ✅ |
| Typecheck | — (too slow per commit) | `typecheck` | `typecheck` | ✅ |
| Unit + component tests | — | `test` | `test` | with coverage ✅ |
| Integration + isolation | — | — (needs Docker; CI) | `test:integration`, `test:isolation` on demand | ✅ |
| E2E | — | — | `test:e2e` on demand | ✅ |
| `npm audit` (high+) | — | — | — | ✅ |
| CodeQL | — | — | — | ✅ |

The pre-push hook runs `npm run check` in each package the push changes and blocks the push if it fails (DEVELOPMENT DV-37). CI always runs everything, whichever packages changed. **Not set up yet:** the CI column arrives with #33. Until then the pre-commit and pre-push hooks are the only checks that run automatically.

ESLint rules that carry weight (beyond the recommended sets):

| Rule | Why |
|---|---|
| `no-restricted-imports` on `**/domain/**` | AR-05 — the pure core stays pure |
| `no-restricted-imports` of other modules' `*.repository`/`schemas` | AR-09 |
| `@typescript-eslint/no-explicit-any`, `no-non-null-assertion` | DV-02, DV-03 |
| `no-console` | DV-11 |
| `@typescript-eslint/no-floating-promises` | an un-awaited write is a silent data loss |
| `no-restricted-syntax` for hex colours and `px` literals in `sx` (frontend) | DS-01 |
| `react/jsx-no-literals` on components (frontend) | DS-20 |
| `jsx-a11y` recommended (frontend) | DS-21 |

| | |
|---|---|
| **TS-30** | Hooks (pre-commit and pre-push) are never bypassed (`--no-verify`) by agents — a push the pre-push hook rejects is fixed, not forced — and a lint rule is never disabled to make a change pass without a justification comment on that line. |
| **TS-31** | A failing check is fixed, not retried. A flaky test is quarantined with an issue link and fixed within the milestone — it is never re-run until green. |

## 10. Performance

SPEC-003 sets the budgets (BR-003-06 to BR-003-10): measured against the reference workload on every **release candidate**, and a missed budget blocks the release unless a waiver is recorded. The harness — reference workload seeding plus Lighthouse/Playwright timing on the 4G profile — is deferred with the deploy target (BL-002). Until then, the cheap structural check stays in the PR suite: list endpoints are paginated (AR-35) and every list query uses an index (an `explain()` assertion in integration tests for the main search).

## 11. What is not tested

- Third-party internals — NestJS, Mongoose, MUI, next-intl, Stripe SDK
- Next.js framework behaviour
- Pixel-level visual regression
- Load beyond the SPEC-003 reference workload
- Live providers — Caixa, Stripe, OpenAI — replaced by fixtures and fakes (TS-07)

---

## Summary — what blocks a merge

| Check | Blocking |
|---|---|
| Typecheck · lint · format, both packages | ✅ |
| Unit, service and component tests | ✅ |
| Integration tests on real MongoDB | ✅ |
| **Isolation tests, every owned collection** | ✅ |
| Coverage: 100% branch on critical modules, 80% overall | ✅ |
| E2E journeys, desktop + 360 px, with axe | ✅ |
| Structural checks (Node pin, tokens, env example) | ✅ |
| `npm audit` high+, CodeQL high+ | ✅ |
| Build, both packages | ✅ |
| Performance budgets | Release candidates (deferred, BL-002) |
