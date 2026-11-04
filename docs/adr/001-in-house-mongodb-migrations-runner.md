# ADR-001 — In-house MongoDB migrations runner

**Status:** Accepted
**Date:** 2026-11-03
**Related:** AR-28, AR-29, DV-34, DV-33, #34, #40 (BL-001)

## Context

#34 moves money from JS numbers to `Decimal128` (AR-17) and converts coupon discounts in place from integer centavos to reais. AR-28 makes that three steps: expand (writers write the new shape, readers accept both), backfill, contract (readers accept only the new shape). AR-29 requires the backfill to be a versioned migration in `backend/src/migrations/`, forward-only and idempotent, run as a gated step before the new code starts (DV-34). There was no migration tooling in the repository, so the first migration forced the choice of a runner.

What a runner has to do here is small: keep an ordered list of migrations, remember which ones a database has applied, apply the rest in order, stop at the first failure, and do it from the deploy image with the configuration the API already validates (AR-41).

## Options

**[migrate-mongo](https://github.com/seppevs/migrate-mongo).** The common choice for MongoDB. It brings its own CLI, its own config file (`migrate-mongo-config.js`) with its own way of finding the connection string, a changelog collection, and `up`/`down` pairs. What breaks or does not fit:

- It reads the connection from its own config file, outside `src/config/env.schema.ts`, so the URI would be validated in two places, or not at all (AR-41, AR-42).
- Migrations are plain JavaScript modules loaded by its CLI from a directory; ours are TypeScript compiled with the rest of `src/`, type-checked and linted with the same rules (AR-45, AR-24, AR-09). Using it would mean either a second build or migrations outside `tsc`.
- Its `down` scripts invite rollbacks of data, which AR-29 rules out (forward-only; rollback is redeploying the previous image, DV-33).
- It is a new dependency with its own transitive tree in the production image, for about a hundred lines of logic, and its lockfile entries need `npm audit` attention like any other (SC-19).

**Mongoose-based tools (`ts-migrate-mongoose` and similar).** They run migrations through the application's models. A migration that goes through today's schema stops doing what it did when it was written as soon as the schema changes; the migration of this ADR exists precisely because the schema is changing under the data.

**In-house runner.** A `Migration` is an id and an `up(db)` against the driver; a registry lists them in order; a runner applies the pending ones and records each in a `migrations` collection; an entry point compiled with the rest of `src/` connects with the validated configuration.

## Decision

The in-house runner, in `backend/src/migrations/`:

- `migration.ts`: the `Migration` interface, `{ id, description, up(db) }`. `up` uses the driver (`mongo.Db`), never the application's models, and must be idempotent. There is no `down`.
- `registry.ts`: every migration in order. A new one is appended; an applied one is never edited or removed.
- `migration-runner.ts`: refuses a registry whose ids are not `NNNN-short-title` in strictly ascending order; applies, in order, every migration not yet recorded; records each, with the injected `Clock` (AR-24), only after its `up` resolves; stops at the first failure, which stays unrecorded and is retried by the next run. It warns about recorded ids the code does not know (a database ahead of the code after a rollback) and leaves them alone.
- `migration-log.ts`: the record, one document per applied migration in the `migrations` collection, `{ _id: '<id>', appliedAt }`. The unique `_id` makes a second record of the same id fail.
- `run.ts`, run by `npm run migrate` (`node dist/migrations/run.js`): a Nest application context (`MigrationsModule`) with the same `ConfigModule` validation and the same MongoDB connection setup as the API (`common/mongo/mongoose-root.ts`), no HTTP server and no schedulers. It exits 0 when every migration is applied and 1 otherwise, logging through the Nest `Logger` (AR-45).

The deploy pipeline runs `npm run migrate` as a gated step before rolling out the new image (DV-34). Until that pipeline exists (BL-001, #40), the owner runs it by hand from their machine against the production database (MongoDB Atlas), before merging code that depends on it.

## Consequences

- Easy: a migration is TypeScript under every lint rule, tested like any other code (unit specs for its conversions, an integration spec on Testcontainers for its run, TESTING §2), and built into the same image as the API, so the migration and the code that depends on it always ship together.
- Easy: no new dependency, nothing to configure beyond the environment the API already requires.
- Hard: we own the runner. Anything beyond ordering, recording and stopping — locking against two concurrent runs, dry runs, a status command — is ours to write. Concurrent runs are not locked today: the gated step runs once per deploy, and each migration is idempotent, so a second concurrent run converts nothing a first one already converted; a lock is worth adding if that ever changes.
- Forecloses: `down` migrations. A mistake is fixed by a new forward migration, and a release is rolled back by redeploying the previous image over data both versions read (AR-28, DV-33).
- If the runner ever outgrows this, replacing it means importing the `migrations` collection's ids into the new tool's changelog; the ADR that does so supersedes this one (DV-32).
