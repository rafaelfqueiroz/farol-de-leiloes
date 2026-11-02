// Jest globalSetup of the integration and isolation projects (jest.config.ts): one MongoDB
// container per run, shared by every spec file, each of which uses its own database on it
// (TS-05, test/support/test-database.ts). DV-17: databases always come from containers;
// Testcontainers maps a random host port, so the developer's own MongoDB is never touched.
import { MongoDBContainer } from '@testcontainers/mongodb';
import { getContainerRuntimeClient } from 'testcontainers';
import { MONGO_IMAGE, TEST_MONGODB_URI, setSharedMongo, sharedMongo } from './mongo-container';

function dockerRequired(cause: unknown): Error {
  const reason = cause instanceof Error ? cause.message : String(cause);
  const message = [
    '',
    'Docker is required (DV-17): test:integration and test:isolation start MongoDB (mongo:7)',
    'with Testcontainers. Start Docker (Docker Desktop, Colima, OrbStack...) and run again.',
    `Testcontainers said: ${reason}`,
    '',
  ].join('\n');
  const error = new Error(message);
  // Jest prints the stack of a global-setup failure; a library stack trace would bury the fix.
  error.stack = message;
  return error;
}

export default async function mongoGlobalSetup(): Promise<void> {
  const running = sharedMongo();
  // Both projects may run in one invocation (`jest --selectProjects integration isolation`):
  // the second one reuses the container instead of starting another.
  if (running) {
    running.users += 1;
    return;
  }

  try {
    await getContainerRuntimeClient();
  } catch (error) {
    throw dockerRequired(error);
  }

  let container;
  try {
    container = await new MongoDBContainer(MONGO_IMAGE).start();
  } catch (error) {
    throw dockerRequired(error);
  }

  setSharedMongo({ container, users: 1 });
  // Workers are spawned after global setup and inherit this environment.
  process.env[TEST_MONGODB_URI] = container.getConnectionString();
}
