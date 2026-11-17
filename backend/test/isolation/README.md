# Isolation tests

The blocking gate of TESTING §4 (SPEC-002, TS-13 to TS-18): for every owned or account-owned
collection, two owners are seeded and the HTTP API proves that neither sees, counts or changes the
other's data, and that a foreign id answers exactly like a missing one.

`npm run test:isolation` runs this folder against MongoDB from Testcontainers (Docker required,
DV-17), each spec file on its own database via `useTestDatabase()` (TS-05). There is no
`--passWithNoTests`: an empty suite fails.

| File                                                           | What it proves                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model-coverage.isolation.spec.ts`                             | **The gate (TS-14, AR-16).** Compiles the API's `FEATURE_MODULES`, lists every Mongoose model and fails on an owned model (`ownerId`) or an `'account'`-marked model that no spec names, and on a model with neither `ownerId` nor `markIsolation(...)` (`src/access/isolation-mark.ts`). Tests its own failure modes too. |
| `favorites`, `saved-filters`, `reminders` `.isolation.spec.ts` | BR-002-02: an account's own data, between two accounts (and the office of one of them); `reminders` also names `NotificationLog`, written by the scheduler for each reminder's own account (BR-002-29).                                                                                                                    |
| `probe.isolation.spec.ts`                                      | The owner-scoping acceptance criteria on a test-only owned collection (`support/probe.module.ts`): offices A and B sharing investor X, the investor view, ended and pending links, a removed member, a read-only office, an admin.                                                                                         |
| `owner-counter.isolation.spec.ts`                              | BR-002-13: plan-limit counters per owner, and concurrent creates one below the limit (the in-transaction order, `ensureCounter` first, is in `test/integration/owner-counter.spec.ts`).                                                                                                                                    |

## Adding a spec

A new owned collection (`ownerType`/`ownerId`, ARCHITECTURE §4) or account collection (marked
`'account'`) gets `test/isolation/<collection>.isolation.spec.ts` whose top level is

```ts
isolationSpecFor('<ModelName>', () => {
  // seed two owners through the API; assert TS-15..TS-18, each test named after its rule
});
```

`<ModelName>` is the Mongoose model name (`connection.modelNames()`). The gate parses the files
with the TypeScript parser for these calls, so nothing else needs registering. Only a real call with
a string-literal name counts — never a comment or a string — and its body must run an `it(...)` or
`test(...)`. A file that names a model and skips, focuses or postpones a test (`.skip`, `.todo`,
`.only`, `.skipIf`, `.runIf`, `.fails`, `xit`, `xdescribe`, ...) fails the gate and covers nothing.

Parsing is only the first layer, because a call can contain an `it(...)` and run none (a loop over
no scenarios, an environment-conditional registration, a helper never called). The second layer is
the run itself: `isolationSpecFor` stamps each test that runs inside it with its model, and after
all files finish `IsolationRunReporter` (`support/isolation-reporter.ts`, registered in
`vitest.config.mts`) fails the run — non-zero exit, message naming each model — for any owned or
account model without an isolation test that **ran and passed**. It applies only when the
enumeration spec ran, so running one file by filter never fails falsely; the full
`npm run test:isolation` always checks. Self-test: `test/structural/isolation-gate-run.spec.ts`
runs a child `vitest run` over `support/__fixtures__/` (no Docker). `support/isolation-app.ts`
(`createIsolationApp`) boots the real auth stack with the modules under test, accounts with
confirmed emails (`signUp`, `signUpAll`) and one `FakeAccessSources` the spec drives per account
(`sources.forAccount(id, {...})`, `sources.plans`); `answerOf` gives the status and body that
BR-002-12 compares.
