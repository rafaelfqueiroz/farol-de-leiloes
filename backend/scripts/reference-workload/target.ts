// DV-19: the seed writes thousands of documents and replaces the seeded accounts, so it must
// never reach the developer's database or a real cluster. It writes only to the E2E Compose
// stack's MongoDB (service `mongo-e2e`, which nothing else uses), or to a host the caller names
// explicitly (SEED_ALLOW_HOSTS) — the Testcontainers MongoDB of the seed's own integration spec,
// or the performance run's stack. Atlas (`mongodb+srv`, `*.mongodb.net`) is refused even when
// named.

/** The MongoDB service of the E2E Compose stack (frontend/e2e/compose.e2e.yml). */
export const E2E_MONGO_HOST = 'mongo-e2e';

const URI_SHAPE = /^mongodb:\/\/(?:[^@/]*@)?([^/?]+)\/([^/?]*)(?:\?.*)?$/;

/** A refusal or bad setting of the seed: its message names no secret, so it may be logged. */
export class SeedConfigError extends Error {
  override name = 'SeedConfigError';
}

/** Why `uri` is refused, or null when the seed may write to it. */
export function seedTargetProblem(uri: string, allowHosts: readonly string[] = []): string | null {
  if (uri.startsWith('mongodb+srv:')) {
    return 'mongodb+srv URIs (Atlas) are never a seed target';
  }
  const match = URI_SHAPE.exec(uri);
  if (!match) {
    return 'SEED_MONGODB_URI must be mongodb://host[:port]/database';
  }
  const [, hostList = '', database = ''] = match;
  if (database === '') {
    return 'SEED_MONGODB_URI must name its database';
  }
  // A replica-set URI lists several hosts; every one must be allowed.
  const hosts = hostList.split(',').map((host) => host.replace(/:\d+$/, '').toLowerCase());
  const allowed = new Set([E2E_MONGO_HOST, ...allowHosts.map((host) => host.toLowerCase())]);
  for (const host of hosts) {
    if (host.endsWith('.mongodb.net')) return `${host} is an Atlas cluster, never a seed target`;
    if (!allowed.has(host)) {
      return (
        `${host} is not the E2E stack's MongoDB (${E2E_MONGO_HOST}). Name it in SEED_ALLOW_HOSTS ` +
        'only if it is a throwaway test database (DV-19)'
      );
    }
  }
  return null;
}
