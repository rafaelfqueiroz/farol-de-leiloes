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
| **Domain unit** | Nothing — pure functions in `domain/` | Vitest (project `unit`) | next to source, `*.spec.ts` | ms |
| **Service unit** | Fakes of ports and repositories | Vitest (project `unit`) | next to source, `*.spec.ts` | ms |
| **Integration** | Real MongoDB (Testcontainers `mongo:8.2`), Nest testing module, `supertest` | Vitest (project `integration`) | `backend/test/integration/` | seconds |
| **Isolation** | Real MongoDB, two or more owners, through the HTTP API | Vitest (project `isolation`) | `backend/test/isolation/` | seconds |
| **Component** | jsdom, real theme, real pt-BR catalogue | Vitest + Testing Library + `vitest-axe` | next to source, `*.test.tsx` | ms |
| **E2E** | Full stack in Compose, providers stubbed | Playwright + `@axe-core/playwright` | `frontend/e2e/` | minutes |
| **Structural** | The repository itself (configs, tokens, versions) | Vitest (project `structural`) | `backend/test/structural/`, `frontend/test/structural/` | ms |
| **Dist smoke** | The compiled `backend/dist/`, loaded by a plain `node` process | Vitest (project `smoke`), after `npm run build` | `backend/test/smoke/` | seconds |

**Why a dist smoke test.** The backend runs as native ESM (DEVELOPMENT §1). Neither `tsc` nor Vitest loads modules the way Node does: Vitest's interop fills in a CommonJS package's namespace, so `import * as Papa from 'papaparse'` passed every spec and was undefined in production. `test/smoke/dist-import-graph.spec.ts` loads every compiled module (all but the two entry points, `main.js` and `migrations/run.js`, which start the app as they load) in a child `node` process with the fake environment of `test/support/test-env.ts`, and fails on any module Node cannot link or evaluate; `test/structural/esm-interop.spec.ts` covers namespace imports, which link even when the member they read is missing. `npm run test:smoke` builds first; CI runs it in `backend-build`.

A controller's HTTP contract that needs no database — query-string parsing, the raw body of the Stripe webhook — is a unit spec next to the controller: a Nest testing module with its services stubbed, driven with `supertest` (e.g. `auctions.controller.spec.ts`). `test/support/http-app.ts` (`createHttpApp`) signs a test user in and puts the `AccessContext` the real factory builds for it on the request (SPEC-002), with no relationships unless the spec passes `access: fakeAccessSources({...})`; an admin spec signs in `{ ...TEST_USER, isAdmin: true }`. supertest binds an ephemeral loopback port in the test process, so nothing leaves the machine (TS-01, TS-07). Anything that needs MongoDB is an integration spec.

`backend/vitest.config.mts` declares one Vitest project per backend row above, and each script selects its projects (DEVELOPMENT §6). Specs import `describe`, `it`, `expect` and `vi` from `'vitest'`; there are no globals. Shared test code lives beside the suites, never in `src/`:

| Folder | Holds |
|---|---|
| `backend/test/support/` | Harness code: `fixtures.ts` (paths of the captured Caixa fixtures), the MongoDB global setup and teardown, `test-database.ts` (`useTestDatabase()`), `silence-logger.ts` (the setup file that silences the Nest Logger), `stub-subscriptions-module.ts` (a unit spec that imports `AccessModule` only to run the guards swaps SPEC-012's `SubscriptionsModule` for it with `overrideModule`, since that module needs MongoDB and the payment gateway) |
| `backend/test/fakes/` | Hand-written fakes of ports (TS-03), e.g. `FakeClock` (TS-06), `FakePaymentGateway` (AR-10; `setSubscription` is what the provider currently says, `onRetrieve` / `afterRetrieve` hold or break a read, the latter after its snapshot is taken so the answer is already stale, for the SPEC-012 lease, dirty-mark and ordering specs; the billing operations record what they were asked: an upgrade is PENDING until `payPendingChange`, a refund is deduplicated by its key, `onRefund` holds one, `listsPlan` registers the provider price a catalog definition needs), `FakeCoupons`, `FakeOwnerCounters` (the journey counters, same semantics as the conditional update), `FakeEmailSender` (also records the payment-failed email), `FakeOfficeProvisioner` (idempotent by ref, as SPEC-011's must be) and the in-memory subscription, event-ledger and plan repositories (the conditional updates and unique indexes they imitate are proven on MongoDB in `test/integration/subscriptions-*.spec.ts`, `journey-slots.spec.ts` and `billing-indexes-migration.spec.ts`: 20 racing journey starts with one free slot give one success, the refund claim wins once in 20, two members cancelling at once refund once, one open checkout per key), `FakeAccessSources` (the SPEC-002 seams: memberships, office plans, client links, self-advised; `accessContextFactory()` builds real contexts over them) |
| `backend/test/builders/` | Test-data builders (TS-29), e.g. `aJobExecution()` |
| `backend/test/fixtures/caixa/` | Captured Caixa pages and lists (TS-28) |

**The Nest Logger is silent in tests.** Every backend project runs `backend/test/support/silence-logger.ts` as a Vitest setup file (`setupFiles` in `vitest.config.mts`): `Logger.overrideLogger(false)` silences the `new Logger(Name)` instances of services (AR-45), and `Test.createTestingModule()` is wrapped so the testing module's own logger, which would still print every `error`, starts silent too. Specs that walk error paths therefore do not bury real failures or the pre-push output (DV-37). A spec that asserts on logging spies on the logger explicitly and sees every call whatever the level: `const error = vi.spyOn(Logger.prototype, 'error'); ... expect(error).toHaveBeenCalledWith(...)`. A spec never re-enables output to "see" a log; it reads the spy. To see logs locally while debugging, install a real logger and do not commit it: `Logger.overrideLogger(new ConsoleLogger())` after the testing module is compiled (compiling installs the silent logger again), or `.setLogger(new ConsoleLogger())` on the testing builder before `compile()`. `Logger.overrideLogger(true)` does not work: any non-object argument leaves logging disabled. Output other than the runner's report in `npm test` is a defect to fix, not to ignore.

**The test database.** `test:integration` and `test:isolation` start **one** `mongo:8.2` container per run in Vitest's global setup (Testcontainers maps a random port, DV-17) and expose it as `TEST_MONGODB_URI` — deliberately not `MONGODB_URI`, so a test can never pick up the application's database (DV-19). The `mongo:8.2` tag floats only within 8.2 patches (8.0 and 8.3 images do not start on the Linux 6.19+ kernels of GitHub's runners, SERVER-136848), while Atlas runs 8.0 or newer and upgrades itself, so a change to the image or the driver also runs both suites once on `mongo:9`, by changing `MONGO_IMAGE` in `test/support/mongo-container.ts` temporarily. Each spec file calls `useTestDatabase()` once at its top level: it returns the file's own database (a name derived from the spec path plus a random suffix) and drops it in `afterAll` (TS-05). It throws when `TEST_MONGODB_URI` is unset and never falls back to `localhost`. Both scripts need Docker running; without it they stop at once with a "Docker is required (DV-17)" message. On Rancher Desktop without admin access, where the socket is only `~/.rd/docker.sock`, set `DOCKER_HOST=unix://$HOME/.rd/docker.sock` and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock` (or `docker.host` in `~/.testcontainers.properties`). `test/isolation/` is empty until the first isolation spec lands with #2, so `test:isolation` runs with `--passWithNoTests` until then.

| | |
|---|---|
| **TS-01** | Domain and service unit tests never touch a database or the network. If a domain rule needs a database to be tested, the layering is wrong (AR-05). |
| **TS-02** | Repository and isolation tests run against real MongoDB. Never mock Mongoose — mocking the database mocks away the owner filter being verified. |
| **TS-03** | Ports (AR-10) and repositories are faked with **hand-written fakes that implement the real interface**, not `vi.mock`. A fake breaks at compile time when the interface changes; a mock keeps passing. `vi.mock` is reserved for modules with no port (rare, and commented). |
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
| **TS-11** | Calendar logic is tested on its boundaries: 23:59 and 00:00 in Brasília vs UTC, month ends, 29 February anniversaries (SPEC-010 BR-010-19), and a rule-based zone rather than a fixed offset (SPEC-003 BR-003-28). Specs whose answer must not depend on the host zone run once per zone: on the backend as the `tz-UTC`, `tz-Asia/Tokyo` and `tz-America/Sao_Paulo` Vitest projects (`vitest.config.mts`, `timeZoneSpecs`), on the frontend as the `dates:*` projects (`vitest.config.ts`). |
| **TS-12** | The Caixa parser is tested on fixtures covering the awkward cases: BOM, metadata rows, reordered or missing columns, malformed prices, an empty list, and the bot-protection page — which must stop the run, not be parsed (SPEC-004 BR-004-20). |

## 4. Isolation tests — the blocking gate

| | |
|---|---|
| **TS-13** | Every owned collection has an isolation test. **This gate blocks merges** regardless of suite time. |
| **TS-14** | Coverage is enforced by a test that **enumerates the registered Mongoose models** and fails on any model with an `ownerId` path and no isolation spec, or without one and not explicitly marked (AR-16). Never a hand-maintained list — it goes stale silently. Live: `test/isolation/model-coverage.isolation.spec.ts` (below). |
| **TS-15** | Tests run at the **API surface**, not the repository: lists, details, counts, search, exports, notifications and file links. Leaks happen in aggregates and side channels, above where repository tests look. |
| **TS-16** | Standard shape: seed offices A and B and investors on each side with distinguishable data; as each persona of A, exercise every read path; assert nothing of B's appears — not in bodies, not in counts, not in error messages. |
| **TS-17** | A request for B's record by id returns exactly the response of a non-existent id (SPEC-002 BR-002-12). A request carrying B's owner id in the path, query or body acts on the caller's own context (BR-002-11). |
| **TS-18** | Access follows current state: after a member is removed or a link ends, the next request is refused (BR-002-15, BR-002-07). Cross-owner jobs deliver only to accounts entitled at delivery time (BR-002-29). |

**How the gate works (#2).** `npm run test:isolation` (Docker, Testcontainers) runs `backend/test/isolation/`:

- `model-coverage.isolation.spec.ts` compiles the API's `FEATURE_MODULES` (`src/feature-modules.ts`, what `AppModule` imports after its infrastructure; `AppModule` itself is not compiled because its `ConfigModule` reads the environment and a `.env` at import, DV-19) on the spec's database, lists `connection.modelNames()` and fails on an owned model (`ownerId`) or an `'account'`-marked model that no isolation spec names, and on a model with neither `ownerId` nor `markIsolation(...)`. A spec names a model by calling `isolationSpecFor('<ModelName>', () => { ... })` (`support/isolation-spec.ts`); the gate finds the calls by parsing every `test/isolation/**/*.isolation.spec.ts` with the TypeScript parser (`support/isolation-coverage.ts`), so there is no list to keep. Only a real call with a string-literal name counts (a comment or a string never does); the call's body must run an `it(...)` or `test(...)`, and a file that names a model and uses `.skip`, `.todo`, `.only`, `.skipIf`, `.runIf`, `.fails`, `xit`, `xdescribe` (or another skip or focus alias) fails the gate and covers none of its models. Its own failure modes are tested in the same file.
- **Syntax is not proof: the run is (TS-14).** A call can contain an `it(...)` and register none (a loop over an empty scenarios array, an environment-conditional registration, a helper nobody calls), so the parser alone is never sufficient. `isolationSpecFor` stamps every test that actually runs inside it with its model (`task.meta`, from an `afterEach`), and the AR-16 test of the enumeration spec stamps itself with the required models (owned and account kinds). `IsolationRunReporter` (`support/isolation-reporter.ts`, registered in `vitest.config.mts`) runs after ALL files finish and fails the run (`process.exitCode = 1`, message naming each model) for every required model without an isolation test that ran and **passed**. It applies only when the enumeration spec ran and passed, so a single file run by filter (`vitest run --project isolation <file>`) never fails falsely; the full `npm run test:isolation` always checks. The logic is `support/executed-isolation.ts`; `test/structural/isolation-gate-run.spec.ts` proves it with a child `vitest run` over `support/__fixtures__/` (empty loop, conditional, uncalled helper, failing test, positive case), Docker-free.
- Log hygiene also covers the billing flows (SC-15): `log-hygiene.isolation.spec.ts` runs the office plan routes, the payment-failed email (member contact name and address as markers), a first checkout (buyer name) and the reconcile job.
- SPEC-010: `consents` and `whatsappConsents` are `internal` (read by the caller's own id), so the gate needs no spec for them; `privacy.isolation.spec.ts` proves their API surface with two accounts (A never reads B's acceptances or consent; a request of A carrying B's id in the query acts on A, a body naming B is refused, BR-002-11), and `log-hygiene.isolation.spec.ts` covers the sign-up acceptance and WhatsApp answer flows (no name or e-mail marker in any log or error answer).
- SPEC-010 part 2: `dataExports`, `actorPseudonyms` and `jobLocks` are `internal`; `privacy-rights.isolation.spec.ts` proves the owner surface of the rights (A never reads, downloads or deletes B's exports, nor closes B's account or spends B's Google proof, BR-002-11) and `personal-data-registry.isolation.spec.ts` is the registry meta-test (every model with a `userId`, `requesterUserId`, `authorUserId`, `buyerUserId`, `adminUserId` or `createdBy` path is covered by a provider or declared in `RETAINED_MODELS`; failures name the model; its rule's own failure modes are `test/support/personal-data-coverage.spec.ts`). The races of closure, export and purge (two closures at once, a sign-in racing the closure, the export worker racing it, two purge workers, a fault at each purge step, a sign-in during the purge, a sign-up with the closed address before and after) are `test/integration/account-closure.spec.ts` and `account-purge.spec.ts`, run on `createRightsApp` (`test/support/privacy-rights-app.ts`) with `FakeStorage` (the R2 port) and a recording closure hook; `app.scan(markers)` looks in every collection for a name, email or phone.
- API specs: `office-subscription.isolation.spec.ts` (SPEC-012: the `subscriptions` collection is `internal`, so the gate needs no spec for it, but its owner surface, `/api/office/subscription`, is proven with the standard two-office shape: A reads and changes only A, B's id is the same 404 as a missing one and leaves B untouched, a removed member is refused on the next request, the success page's ref belongs to its buyer, a read-only office still manages its plan); `favorites`, `saved-filters` and `reminders` (with `NotificationLog`, delivered by the scheduler) prove BR-002-02 for two accounts; `probe.isolation.spec.ts` proves the owner-scoping acceptance criteria on a test-only owned collection (`support/probe.module.ts`: `ProbeEntity`, `ProbeRepository extends OwnerScopedRepository`, a controller with `@Access()` and the access guards); `owner-counter.isolation.spec.ts` the per-owner plan limit and its concurrency (BR-002-13). `support-grants.isolation.spec.ts` proves the support-grant path (BR-002-23–BR-002-27) through the probe's admin routes (`ProbeAdminModule`): no grant without the requester's permission or for a closed request, nor while another admin holds the request's grant (all the not-found of a nonexistent one), exactly the requester's client-data view, one log entry per record read, refusal after close, withdrawal or 7 days and 1 minute, a failing log insert (a collection validator) blocking the read with no data, a grant bound to its admin, and concurrent opens giving one grant (on the index migration 0005 builds, not autoIndex). Two proofs are at the repository level, with the view obtained the way a route gets it (`test/support/grant-view.ts`, through `GrantReadLogger.readOne`): the view writes nothing (owned and account repositories refuse it; grant routes have no write handlers), and under X's grant X's own favorites, saved filters and reminders are refused with nothing logged (BR-002-02, BR-002-23). `log-hygiene.isolation.spec.ts` is the BR-002-28 log scan: markers seeded through the API into account, support, saved-filter, reminder and owned-record text never appear in any Nest Logger call or stdout/stderr write (`captureAllLogOutput` in `test/support/logger-spy.ts`, which records the arguments), in any line the production logger writes (the app runs nestjs-pino with the API's `loggerParams` at level info into memory, so pino-http completion lines and serialized errors are scanned as production would write them), or in any error answer.
- `support/isolation-app.ts` (`createIsolationApp`) is `createAuthTestApp` with the four access sources bound to one `FakeAccessSources` the spec drives per account (`sources.forAccount(id, { memberships, clientLinks, selfAdvised, ... })`, `sources.plans`), read on every request, and SPEC-009's support requests to a `FakeSupportRequests` (`supportRequests.set(id, requesterId, { open, dataAccessAllowed })`, `.update(...)`); accounts are created through the API with their email confirmed (`signUp`, `signUpAll`), and `answerOf` gives the status and body BR-002-12 compares.

**Adding a spec.** For a new owned or account collection: a file `test/isolation/<collection>.isolation.spec.ts` whose top level is `isolationSpecFor('<ModelName>', () => { ... })`, seeding two owners (and an investor on each side where the collection has one) through the API, then asserting TS-15–TS-18 with each rule id in the test name.

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

### The E2E stack and suite (#3)

`npm run test:e2e` (in `frontend/`) runs Playwright on the host against a Compose stack it brings up and tears down itself (`frontend/e2e/global-setup.ts`, DV-18); it needs Docker running, and on Rancher Desktop the same `DOCKER_HOST` as §2. Nothing starts on the developer's ports or touches their database (DV-19).

| Part | Where | What |
|---|---|---|
| Stack | `frontend/e2e/compose.e2e.yml` | `mongo-e2e` (`mongo:8.2`, tmpfs, no published port) · `seed` · `backend` on `127.0.0.1:38100` · `frontend` (the production image) on `127.0.0.1:38101`. Every value is a fake test value in the file itself; there is no env file |
| Fake providers (TS-22) | `backend/test/e2e-stack/main.ts`, built only by `backend/e2e.Dockerfile` | The production `AppModule` compiled with `@nestjs/testing` overrides: the Caixa importer and scraper are inert (no `@Cron`, nothing at start-up), Stripe is `FakePaymentGateway`, email is `E2eEmailSender` (recorded, never sent); the LLM points at a closed loopback port and reminders are off. Google sign-in is not stubbed yet (no journey follows it; SPEC-001's will). The file lives under `test/`, needs a dev dependency and refuses `NODE_ENV=production`, so it can never be in the production image |
| Seed | `backend/scripts/seed-reference-workload.ts` | The reference workload (SPEC-003 BR-003-08, §10), 2 000 generated auctions by default plus the fixtures, and the seeded accounts |
| Specs | `frontend/e2e/*.spec.ts` | `accessibility.spec.ts`: axe (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) on every route of `e2e/support/routes.ts`, light and dark. `narrow-viewport.spec.ts`: no horizontal page scroll (`scrollWidth <= innerWidth`, BR-003-12). `brasilia-time.spec.ts`: the property page of an auction published for 26/01/2026 10h00 shows `26/01/2026 10:00 (horário de Brasília)` (BR-003-23) |
| Projects | `frontend/playwright.config.ts` | `desktop` (1280 px) and `phone-360` run the per-route specs; `tz-manaus` and `tz-lisbon` (`timezoneId`) run the time-zone spec |

**Signing in.** Signed-in routes use the seeded accounts (`backend/scripts/reference-workload/accounts.ts`, repeated in `frontend/e2e/support/accounts.ts`): a verified premium investor, an admin (seeded with `isAdmin: true`, SPEC-002) and an account that never confirmed its email (for `/verify-email`), test values that exist only in the stack's database (TS-27). The suite signs in through `POST /api/auth/login`, as the app does, rather than through the form; the form is the SPEC-001 journey's.

**Every route.** A new page adds itself to `frontend/e2e/support/routes.ts` in its own PR, with the heading its page shows and, when it redirects by design, where it lands (`landsOn`). Before and after each check the suite asserts the final pathname and that the heading is visible, so a page that redirects (to `/login` or anywhere else) or is squeezed off screen fails the case instead of checking the wrong page (TS-21). A route that fails is fixed, or its failure gets an issue (DV-23) and an entry in `frontend/e2e/support/known-failures.ts`, which marks that case `test.fixme` with the issue number; the checks are never relaxed. Open today: #139 (axe, `/` in light) and #149 (`/search` at 360 px). The SPEC-012 pages are routes too: `/plans` (as a visitor and signed in: the seeded plan catalogue, `backend/scripts/reference-workload/plans.ts`, placeholder values), `/plans/success` (without a `ref`, and with a `ref` nobody owns, which is the error state), `/plans/cancel` and `/office/plan`. The office plan needs an account that is an office member and offices do not exist until SPEC-011, so the stack is not given one: the seeded investor opens it in its empty state, and every state with a plan (active, scheduled change, past due, cancelling, grace, read-only, the dialogs) is the component test's (`OfficePlanPage.test.tsx`, light and dark, axe). The waiting and confirmed states of `/plans/success` need a checkout the provider confirmed, which the fake gateway never produces (`page.test.tsx`).

**Knobs.** `E2E_KEEP_STACK=1` leaves the stack up after the run, `E2E_REUSE_STACK=1` runs against a stack already up, `E2E_SEED_AUCTIONS` sets the catalog size (`full` for the full catalog), `E2E_WEB_PORT` / `E2E_API_PORT` move the ports. Specs are `*.spec.ts` under `e2e/`, which Vitest never collects (its projects take `*.test.ts[x]`). CI runs the same command in the `e2e` job and uploads the HTML report, traces and screenshots when it fails.

## 7. Coverage gates

| Scope | Threshold | Blocking |
|---|---|---|
| Critical `domain/` modules (AR-06) | **100% branch** | ✅ |
| Backend overall | **80% lines and branches** | ✅ |
| Frontend overall | **80% lines and branches** | ✅ |
| Isolation — every owned collection | **100%** (TS-14, live since #2: `model-coverage.isolation.spec.ts`) | ✅ |

80% is the target, and both packages gate on it: `coverage.thresholds` in `backend/vitest.config.mts` and in `frontend/vitest.config.ts` set 80% lines and 80% branches, and a PR that drops either below fails `test:cov`. `npm run test:cov` enforces it (backend: Vitest with V8 coverage over the `unit` and `structural` projects; frontend: Vitest with V8 coverage) and writes an lcov report to `coverage/`.

The frontend reached the 80% target in #57 (measured 95.6% lines / 91.6% branches, from 65.5% / 66.4%): its `coverage.thresholds` are 80 lines and 80 branches, with no floor left to ratchet. The thin BFF route handlers under `app/api/` are covered together by one table-driven spec (`app/api/bff-routes.test.ts`): method, path, body, the `Authorization` header built from the session cookie (the browser's own is ignored, SC-02), the `Origin` check, `401 UNAUTHENTICATED` without a call to the backend, and the error pass-through (AR-38).

The module-boundary regressions in #51 measured 65.39% lines / 61.73% branches and raised the backend floor to 65% / 61%. The PR #98 review regressions then measured 66.20% / 62.62%, raising the floor to 66% / 62%. The #37 security regressions, including owner-review fixes, measured 66.90% / 62.96%, retaining that floor.

**The backend floor was re-baselined in #62.** The backend moved from Jest with ts-jest to Vitest with V8 coverage; the new instrument measures the source, where ts-jest also counted the helpers `tsc` emits for decorators. The floor went from 23% lines / 14% branches to 21% / 16% because the instrument changed, not because any code lost a test. It ratchets up from here as before: #61 raised it to 23% / 19% with the HTTP specs of the auctions and payments controllers, and #35 to 40% / 30% with the HTTP and OpenAPI contract specs, then to 44% / 36% with the unit specs of the SC-10 query guards; #34 to 53% / 50% with the money, Clock and payment-port specs; #36 to 60% / 57% with the observability, health and job-outcome specs. #36 also landed the first `domain/` file (`src/health/domain/health-report.ts`), so the 100% branch gate of TS-24 is now live. #57 raised the backend floor to the 80% / 80% target (measured 91.86% / 87.01%) with unit specs for the services, jobs, controllers and adapters that had little or none.

| | |
|---|---|
| **TS-24** | 100% on critical modules is **branch** coverage, not line. The edge cases — a zero, a missing rate, a closed journey — are branches; lines alone would pass while missing them. `backend/vitest.config.mts` sets `'src/*/domain/**/*.ts': { branches: 100 }`, a static glob: Vitest ignores a threshold glob that matches no file, so the gate is inert until the first `domain/` file lands and then applies to every module's `domain/`, with no config change. The files a glob matches are aggregated, so 100% for the glob means every domain file is at 100%. |
| **TS-25** | Coverage is a floor, not a goal. A covered line proves execution, not correctness; TS-04's hand-computed expectations are what prove correctness. |
| **TS-26** | Do not chase coverage on adapters by testing framework behaviour. Adapters are covered by integration tests that exercise real behaviour. |

## 8. Fixtures and data

| | |
|---|---|
| **TS-27** | **No real personal data in the repository** — not in fixtures, seeds, snapshots, screenshots or bug reports. Names, emails, phones and CPFs in tests are generated and obviously fake (SC-32). |
| **TS-28** | Caixa public pages and lists may be captured as fixtures, trimmed to what the test needs, under `backend/test/fixtures/caixa/` (specs reach them through `test/support/fixtures.ts`). They contain no personal data; if one ever does (an occupant's name in a description), it is redacted before commit. |
| **TS-29** | Test data is built with builders with sensible defaults (`aJourney().forOffice(a).inPhase('REGULARIZAR')`), so a test states only what it cares about. Builders live in `backend/test/builders/` and `build()` returns a plain object. |

## 9. Static checks — what runs, when, where

| Check | Pre-commit (husky + lint-staged) | Pre-push (husky, changed packages only) | `npm run check` (local) | CI on PR and `main` |
|---|---|---|---|---|
| Prettier | `--write` on staged files | `format:check` | `format:check` | `format:check` ✅ |
| ESLint | `--fix` on staged files | `lint` | `lint` | `lint` ✅ |
| Typecheck | — (too slow per commit) | `typecheck` | `typecheck` | ✅ |
| Unit + component tests | — | `test` | `test` | with coverage ✅ |
| Integration + isolation | — | — (needs Docker; CI) | `test:integration`, `test:isolation` on demand, Docker running | ✅ |
| Build + dist smoke (backend) | — | — | `test:smoke` on demand | ✅ (`backend-build`) |
| Coverage gate | — | — | `test:cov` on demand | ✅ |
| E2E | — | — | `test:e2e` on demand, Docker running | ✅ (`e2e`; required once added to the ruleset) |
| `npm audit` (high+) | — | — | — | ✅ |
| CodeQL | — | — | — | ✅ |

The pre-push hook runs `npm run check` in each package the push changes and blocks the push if it fails (DEVELOPMENT DV-37). CI always runs everything, whichever packages changed (DEVELOPMENT §12, `.github/workflows/ci.yml` and `codeql.yml`); its jobs are the required status checks on `main` (DV-27). The `e2e` job runs on every PR and push since #3; it becomes a required check when the owner adds it to the `main` ruleset (DEVELOPMENT §12).

ESLint rules that carry weight (beyond the recommended sets):

| Rule | Why |
|---|---|
| `no-restricted-imports` on `**/domain/**` | AR-05 — the pure core stays pure |
| `no-restricted-imports` of other modules' `*.repository`/`schemas` | AR-09 |
| `@typescript-eslint/no-explicit-any`, `no-non-null-assertion` | DV-02, DV-03 |
| `no-console` | DV-11 |
| `no-restricted-syntax` for argument-less `new Date()` / `Date.now()` outside `common/clock/` | AR-24 — "now" comes from the injected `Clock` |
| `no-restricted-syntax` for `new Date(y, m, d…)`, `toLocale*String` and `Intl.DateTimeFormat` outside the time/number helpers and specs (both apps) | AR-23, DS-29 — one rule for time: zone and locale come from the helpers |
| `@typescript-eslint/no-floating-promises` | an un-awaited write is a silent data loss |
| `no-restricted-syntax` for hex colours and `px` literals in `sx` (frontend) | DS-01 |
| `react/jsx-no-literals` on components (frontend) | DS-20 |
| `jsx-a11y` recommended (frontend) | DS-21 |

| | |
|---|---|
| **TS-30** | Hooks (pre-commit and pre-push) are never bypassed (`--no-verify`) by agents — a push the pre-push hook rejects is fixed, not forced — and a lint rule is never disabled to make a change pass without a justification comment on that line. |
| **TS-31** | A failing check is fixed, not retried. A flaky test is quarantined with an issue link and fixed within the milestone — it is never re-run until green. |

## 10. Performance

SPEC-003 sets the budgets (BR-003-06 to BR-003-10): **p95 of 2 s** for search results and property pages and **3 s** for dashboards and journey pages, on a phone with a 4G connection, against the reference workload, measured on every **release candidate**; a missed budget blocks the release unless a waiver is recorded with it. Merges are not measured: the full workload on every PR would soon be switched off (DL-003-06).

**The reference workload** (BR-003-08) is the seed of §6: `backend/scripts/seed-reference-workload.ts` writes a deterministic catalog the size of the full Caixa catalog for all states (`FULL_CATALOG_SIZE`, 35 000 auctions over the 27 states, weighted like the Caixa list, through the application's schemas and their indexes) plus the seeded accounts, and refuses any database but the E2E stack's unless its host is named in `SEED_ALLOW_HOSTS` (Atlas never; DV-19). The office and investor part (100 in-progress and 500 closed journeys, 20 journeys across 3 offices) is a marked extension point in `reference-workload/seed.ts`, filled as SPEC-011 (#11), SPEC-016 (#16) and SPEC-021 (#21) land. Every run checks that the catalog is the full one (30 000 auctions or more; the summary says so, and the log prints the count) and says when it is not.

**The harness** (`frontend/perf/`, `frontend/lighthouserc.cjs`; #3):

| Part | Where | What |
|---|---|---|
| Profile and budgets | `perf/budgets.cjs` | The one place they are recorded (BR-003-07): `mobile`, simulated throttling, 9 Mbps down, 1.5 Mbps up, 170 ms round trip, **CPU slowdown 4x**, 20 runs per page, and the route groups with their budgets. `perf/budgets.test.ts` pins them to the spec's numbers, so changing one shows in review |
| Lighthouse CI | `lighthouserc.cjs`, `perf/lighthouse-config.cjs` | `@lhci/cli` (exact version) collects 20 runs per URL on Chrome and asserts the budgets |
| Sign-in | `perf/login.cjs` | The puppeteer script of `collect`: signs the seeded investor in the way the app does (the token in `localStorage`) for `/search`, removes it for the public property page, and makes one unmeasured visit so the runs see a warm server, not its cold start. Lighthouse still clears the HTTP cache before each run |
| API check | `perf/api-latency.mjs` | BR-003-09: 200 requests per target with rotating filters (state, city, modality, price, paging) against `GET /api/auctions` and the BFF's `GET /api/search`, p95 against 2 s. A Node client cannot take the 4G profile, so this is the server's share; the page runs carry the network |
| Wrapper | `perf/run.mjs`, `npm run test:perf` | Brings up the E2E stack on the **full catalog** (`E2E_SEED_AUCTIONS=full`, `E2E_KEEP_STACK`, `E2E_REUSE_STACK` as in §6), runs both checks, writes `perf-results/summary.md` (p50, p95 and the worst run per page), `verdict.json` and `api-latency.json`, copies the Lighthouse reports (JSON and HTML per run) to `perf-results/lighthouse/`, tears the stack down. Exit 0 met, 3 missed, 1 a fault. The apps run in Compose only, never on the host (DV-18) |
| Gate | `.github/workflows/performance.yml`, `perf/waiver.mjs` | See below |

**Dependency.** `@lhci/cli` is a frontend dev dependency, pinned exactly. Its transitive `basic-ftp` (through `proxy-agent`, which the harness never uses for FTP) sits in a range with a high advisory, so `frontend/package.json` has an `overrides` entry pinning a patched version, which keeps `npm audit --audit-level=high` green (SC-19); drop it once `get-uri` depends on a fixed range.

**The profile.** 4G is as BR-003-07 states it; Lighthouse's own mobile default is a slower 1.6 Mbps / 150 ms. The processor is the one judgement: Lighthouse's 4x slowdown stands for a mid-tier phone and 6x for a low-end one, so a budget met at 4x is met on a mid-range phone. It is one constant (`cpuSlowdownMultiplier`); raising it tightens every budget at once and needs a reason in the PR. The multiplier is relative to the CPU of the machine running Lighthouse, so a slower host reads slower: the first 3-run check on a GitHub runner read search at about 3.0 s and TTI at 3.3 s where a laptop reads 2.6 s. The release gate runs on the runner and its numbers are the ones that count; a local run is for finding and fixing, and a result near a budget is confirmed on the runner.

**What is asserted.** "Main content visible and usable" (BR-003-07) is two metrics, each at most the page's budget: `largest-contentful-paint` (visible) and `interactive` (usable). BR-003-09 (an action that loads data meets its page's budget) is covered by measuring the search results with a filter in the URL (`/search?state=SP`), so the filter's data load is inside the measured navigation, and by the API check over many filters.

**p95.** Lighthouse CI offers `optimistic`, `median`, `median-run` and `pessimistic` aggregation, no percentile. The assertions use `pessimistic` (the worst run of the URL): over the 20 runs the spec asks for, the nearest-rank p95 is the 19th sorted value, so the worst run is never below it and the gate is never looser than the spec; it differs from p95 only when the single worst run alone is over budget. `perf/stats.mjs` reports the exact p50 and p95 beside the worst run in the summary. Fewer than 20 runs is a check of the harness, not a measurement, and the summary says so.

**Running it.** In `frontend/`, with Docker running (on Rancher Desktop the same `DOCKER_HOST` as §2) and a Chrome (`CHROME_PATH`, else the installed Chrome, else Playwright's Chromium from `npx playwright install chromium`):

```
npm run test:perf                              # 20 runs per page, full catalog, strict exit code
npm run test:perf -- --report-only --runs 3    # a quick look; always exits 0 on a miss
E2E_KEEP_STACK=1 npm run test:perf             # leave the stack up; E2E_REUSE_STACK=1 reuses it
```

**Routes.** The measured routes are in `perf/budgets.cjs`. The dashboards and journeys group (3 s: advisor journey dashboard, investor portal, *carteira*, journey page) is in the file, off, with its routes as comments: those pages do not exist yet. The PR that adds one adds its route and the account that opens it, switches the group on, and extends the seed's journey part so the page is measured at the workload of BR-003-08. `/search` is signed-in only today and is measured as the seeded investor; SPEC-005 (#5) opens it to the public.

**The release gate** (BR-003-10). `performance.yml` runs on a `v*` tag push and on `workflow_dispatch`, never on a schedule and never in `nightly.yml` (it is a heavy job: an image build, a 35 000-document seed and about 40 Lighthouse runs). The `measure` job runs `test:perf --report-only` and uploads `frontend/perf-results/` as the `lighthouse-reports` artifact (the verdict, the summary, the API check and the Lighthouse reports, JSON and HTML per run, in `lighthouse/`; the hidden `.lighthouseci/` is not uploaded by `upload-artifact`, so run.mjs copies it); the `gate` job passes when every budget was met. When one was missed it fails **unless the notes of the release carry a waiver**: one line,

```
Performance waiver: <reason>
```

(a list item or bold is fine, the keyword is not case-sensitive, the reason is the rest of the line and must be a real one: empty, `<reason>`, `TBD` and the like are not waivers). The job reads the notes of the published release with `gh release view` (a draft is not visible to it), echoes the waiver in its summary, and passes. To waive: publish the release with that line, then **Re-run failed jobs**: only `gate` runs again, without measuring. A dispatch names the release with `release-tag`; with none, a miss fails. The gate also refuses a run of fewer than 20 runs per page. A pull request that touches the harness's files runs the same pipeline with 3 runs per page, report-only, so the workflow is verified before a release depends on it.

The probe and the monthly availability report (BR-003-01, BR-003-02, BR-003-04) are not part of this harness; they are #115. The cheap structural check stays in the PR suite: list endpoints are paginated (AR-35) and every list query uses an index (an `explain()` assertion in integration tests for the main search).

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
| Build, both packages; the backend's compiled output loads under plain Node (dist smoke) | ✅ |
| Performance budgets (p95, 4G phone profile, full catalog) | Release candidates: `performance.yml` on `v*` tags, waivable with a recorded reason (§10) |
