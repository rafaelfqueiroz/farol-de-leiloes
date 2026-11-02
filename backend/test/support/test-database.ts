// TS-05: every integration and isolation spec file gets its own database on the shared container
// (started by mongo-global-setup.ts) and drops it in afterAll, so files are independent and can
// run in parallel.
import { randomBytes } from 'crypto';
import { join, relative } from 'path';
import { createConnection } from 'mongoose';
import { TEST_MONGODB_URI } from './mongo-container';

export interface TestDatabase {
  /** The database name, unique to this spec file and this run. */
  readonly name: string;
  /** Connection string for this database, e.g. for `MongooseModule.forRoot(db.uri)`. */
  readonly uri: string;
}

// MongoDB caps database names at 64 bytes; stay at 63 and use only [a-z0-9_-] (names cannot
// contain / \ . " $ * < > : | ? or spaces).
const MAX_NAME_BYTES = 63;
const PREFIX = 't_';
const SUFFIX_BYTES = 4; // 8 hex characters
const BACKEND_ROOT = join(__dirname, '..', '..');

/** `test/integration/job-execution.service.spec.ts` -> `t_integration_job-execution_service_<hex>`. */
export function testDatabaseName(testPath: string, suffix: string): string {
  const slug = relative(BACKEND_ROOT, testPath)
    .replace(/^test[\\/]/, '')
    .replace(/\.spec\.ts$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const room = MAX_NAME_BYTES - PREFIX.length - 1 - suffix.length;
  return `${PREFIX}${slug.slice(0, room)}_${suffix}`;
}

function testMongoUri(): string {
  const uri = process.env[TEST_MONGODB_URI];
  // Never fall back to localhost: that is the developer's own database (DV-19).
  if (!uri) {
    throw new Error(
      `${TEST_MONGODB_URI} is not set. Integration and isolation specs run only through ` +
        '`npm run test:integration` / `npm run test:isolation`, whose global setup starts ' +
        'MongoDB in a container (DV-17). They never use a local database (DV-19).',
    );
  }
  return uri;
}

/**
 * Call once at the top level of a spec file. Returns this file's database and registers an
 * `afterAll` that drops it — register it before the hooks that close your Nest app, so the drop
 * runs first.
 */
export function useTestDatabase(): TestDatabase {
  const testPath = expect.getState().testPath;
  if (!testPath) {
    throw new Error('useTestDatabase() must be called from a Jest spec file.');
  }

  const name = testDatabaseName(testPath, randomBytes(SUFFIX_BYTES).toString('hex'));
  const url = new URL(testMongoUri());
  url.pathname = `/${name}`;
  // The container runs a single-node replica set that advertises its in-container hostname;
  // connecting directly skips discovery of that unreachable name.
  url.searchParams.set('directConnection', 'true');
  const uri = url.toString();

  afterAll(async () => {
    const connection = await createConnection(uri).asPromise();
    try {
      await connection.dropDatabase();
    } finally {
      await connection.close();
    }
  });

  return { name, uri };
}
