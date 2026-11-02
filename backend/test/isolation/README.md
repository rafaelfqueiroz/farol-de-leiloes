# Isolation tests

The blocking gate of TESTING §4: for every owned collection, seed two owners and prove through the
HTTP API that neither sees the other's data (TS-13 to TS-18).

Specs here run with `npm run test:isolation` against MongoDB from Testcontainers (Docker required,
DV-17), each on its own database via `useTestDatabase()` (`test/support/test-database.ts`, TS-05).

The folder is empty until the first spec lands with #2, together with the TS-14 test that
enumerates the registered Mongoose models; until then the script passes with no tests
(`--passWithNoTests`).
