// State shared by mongo-global-setup.ts and mongo-global-teardown.ts. Jest runs global setup and
// teardown in its parent process and only shares `globalThis` between them, so the started
// container is kept there rather than in a module variable.
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';

/** The variable integration and isolation specs read. Deliberately not MONGODB_URI (DV-19). */
export const TEST_MONGODB_URI = 'TEST_MONGODB_URI';

/** TESTING §2: the same major as production. */
export const MONGO_IMAGE = 'mongo:7';

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
