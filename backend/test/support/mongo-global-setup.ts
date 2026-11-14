// Vitest globalSetup of the integration and isolation projects (vitest.config.mts): one MongoDB
// container per run, shared by every spec file, each of which uses its own database on it
// (TS-05, test/support/test-database.ts). DV-17: databases always come from containers;
// Testcontainers maps a random host port, so the developer's own MongoDB is never touched.
import { MongoDBContainer } from '@testcontainers/mongodb';
import { getContainerRuntimeClient } from 'testcontainers';
import { MONGO_IMAGE, TEST_MONGODB_URI, setSharedMongo, sharedMongo } from './mongo-container.js';

function dockerRequired(cause: unknown): Error {
  const reason = cause instanceof Error ? cause.message : String(cause);
  const message = [
    '',
    `Docker is required (DV-17): test:integration and test:isolation start MongoDB (${MONGO_IMAGE})`,
    'with Testcontainers. Start Docker (Docker Desktop, Colima, OrbStack...) and run again.',
    'Rancher Desktop without admin access: DOCKER_HOST=unix://$HOME/.rd/docker.sock and',
    'TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock (or docker.host in',
    '~/.testcontainers.properties).',
    `Testcontainers said: ${reason}`,
    '',
  ].join('\n');
  const error = new Error(message);
  // Vitest prints the stack of a global-setup failure; a library stack trace would bury the fix.
  error.stack = message;
  return error;
}

export async function setup(): Promise<void> {
  const running = sharedMongo();
  // Both projects may run in one invocation (`vitest run --project integration --project
  // isolation`): the second one reuses the container instead of starting another.
  if (running) {
    running.users += 1;
    return;
  }

  try {
    await getContainerRuntimeClient();
  } catch (error) {
    throw dockerRequired(error);
  }

  // Kept so a failed start says what mongod printed, not only that the health check failed.
  const output: string[] = [];
  let container;
  try {
    container = await new MongoDBContainer(MONGO_IMAGE)
      .withLogConsumer((stream) => {
        stream.on('data', (line: Buffer | string) => {
          output.push(String(line).trimEnd());
          if (output.length > 40) output.shift();
        });
      })
      .start();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw dockerRequired(
      new Error(`${reason}\n--- last container output ---\n${output.join('\n')}`),
    );
  }

  setSharedMongo({ container, users: 1 });
  // Test workers are started after global setup and inherit this environment.
  process.env[TEST_MONGODB_URI] = container.getConnectionString();
}

// Vitest ignores a named `teardown` export when the module also has a default export, so both
// hooks are named exports of this one module.
export { default as teardown } from './mongo-global-teardown.js';
