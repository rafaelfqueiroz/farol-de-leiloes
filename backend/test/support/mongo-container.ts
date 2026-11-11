// State shared by mongo-global-setup.ts and mongo-global-teardown.ts. Vitest runs global setup and
// teardown in its main process and only shares `globalThis` between them, so the started
// container is kept there rather than in a module variable.
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';

/** The variable integration and isolation specs read. Deliberately not MONGODB_URI (DV-19). */
export const TEST_MONGODB_URI = 'TEST_MONGODB_URI';

/**
 * TESTING §2: the same major as production. Pinned to 8.2: mongod 8.0.x and 8.3.x refuse to start
 * on Linux kernel 6.19+, which the GitHub runners now have (SERVER-136848, SERVER-136272).
 */
export const MONGO_IMAGE = 'mongo:8.2';

interface SharedMongo {
  container: StartedMongoDBContainer;
  /** Projects (integration, isolation) currently using the container. */
  users: number;
}

const KEY = '__farolTestMongo__';

type GlobalWithMongo = typeof globalThis & { [KEY]?: SharedMongo };

export function sharedMongo(): SharedMongo | undefined {
  return (globalThis as GlobalWithMongo)[KEY];
}

export function setSharedMongo(value: SharedMongo | undefined): void {
  (globalThis as GlobalWithMongo)[KEY] = value;
}
