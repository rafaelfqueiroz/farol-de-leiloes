// setupFilesAfterEnv of the integration and isolation projects. Jest 29 has no per-project
// testTimeout, and a real database round trip (plus Nest bootstrapping in beforeAll) needs more
// than the 5 s default. Container start-up happens in global setup and is not counted here.
jest.setTimeout(30_000);
