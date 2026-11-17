// A minimal Vitest config for the isolation gate's own self-test (../executed-isolation.gate.spec.ts):
// it runs the fixtures in this folder in a child `vitest run`, with the real reporter. Docker-free.
// The folder is outside every project of the main config (those include only *.spec.ts).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['*.fixture.ts'],
    environment: 'node',
    reporters: ['default', '../isolation-reporter.ts'],
  },
});
