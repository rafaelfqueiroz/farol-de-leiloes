// DV-18: `npm run test:e2e` brings up its own Compose stack (e2e/compose.e2e.yml), runs the specs
// against it and always tears it down, volumes included. Agents never start the apps on the host;
// this stack runs in containers on its own ports.
//
//   E2E_KEEP_STACK=1   leave the stack running after the run (to inspect it, or to reuse it)
//   E2E_REUSE_STACK=1  use a stack that is already up instead of building one
//   E2E_SEED_AUCTIONS  catalog size for the seed (compose.e2e.yml); `full` for the perf run
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const COMPOSE_FILE = join(import.meta.dirname, 'compose.e2e.yml');

function compose(...args: string[]): void {
  execFileSync('docker', ['compose', '-f', COMPOSE_FILE, ...args], { stdio: 'inherit' });
}

function tearDown(): void {
  if (process.env.E2E_KEEP_STACK === '1') return;
  compose('down', '--volumes', '--remove-orphans');
}

export default function globalSetup(): () => void {
  if (process.env.E2E_REUSE_STACK === '1') return () => undefined;
  try {
    // --wait: returns once every service is healthy and the seed has completed.
    compose('up', '--build', '--detach', '--wait', '--wait-timeout', '600');
  } catch (error) {
    // The stack's logs carry only the fake test data of the seed (TS-27).
    compose('logs', '--no-color', '--tail', '200', 'seed', 'backend', 'frontend');
    tearDown();
    throw error;
  }
  return tearDown;
}
