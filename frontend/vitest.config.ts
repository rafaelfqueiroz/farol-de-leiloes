import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

const dateTests = [
  'lib/dates.test.ts',
  'lib/brasilia-date-adapter.test.ts',
  'app/components/DateField.dst.test.tsx',
];

export default defineConfig({
  plugins: [react()],
  // Vite 8 resolves the `@/` alias from tsconfig natively (DV-09)
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'jsdom',
    // TS-06, AR-23: date regressions must also fail on a developer's Brasília host.
    env: { TZ: 'Asia/Tokyo' },
    setupFiles: ['./test/setup.ts'],
    exclude: [...configDefaults.exclude, '.next/**'],
    // TS-11, AR-23: forks apply the host zone before jsdom/MUI load. Keep the rest of the
    // suite in Tokyo; repeat only focused picker timezone cases and its bridge.
    projects: [
      {
        extends: true as const,
        test: {
          name: 'unit',
          // DV-18: future Playwright *.spec files must not run in jsdom. Keep this on the
          // unit project: Vite concatenates inherited includes into the focused TZ projects.
          include: ['**/*.test.{ts,tsx}'],
          exclude: [...configDefaults.exclude, '.next/**', ...dateTests],
        },
      },
      ...['America/Los_Angeles', 'America/Sao_Paulo', 'Asia/Tokyo'].map((timeZone) => ({
        extends: true as const,
        test: {
          name: `dates:${timeZone}`,
          pool: 'forks' as const,
          include: dateTests,
          env: { TZ: timeZone },
          provide: { timeZone },
        },
      })),
    ],
    // TESTING §7: `npm run test:cov`. Every source file counts, imported by a test or not.
    coverage: {
      provider: 'v8',
      include: ['app/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}', 'i18n/**/*.{ts,tsx}', 'proxy.ts'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts'],
      reporter: ['text-summary', 'text', 'lcov'],
      thresholds: {
        // TESTING §7: floor rounded down from measured coverage; #37 security regressions.
        // The target remains 80% lines and branches (#57); the floor never goes down.
        lines: 56,
        branches: 54,
      },
    },
  },
});
