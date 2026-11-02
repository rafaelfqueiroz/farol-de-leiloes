// Vitest global teardown of the integration and isolation projects (re-exported as `teardown` by
// mongo-global-setup.ts): stops the container started there once the last project using it is
// done.
import { TEST_MONGODB_URI, setSharedMongo, sharedMongo } from './mongo-container';

export default async function mongoGlobalTeardown(): Promise<void> {
  const running = sharedMongo();
  if (!running) return;

  running.users -= 1;
  if (running.users > 0) return;

  setSharedMongo(undefined);
  delete process.env[TEST_MONGODB_URI];
  await running.container.stop();
}
