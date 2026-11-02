import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // Vite 8 resolves the `@/` alias from tsconfig natively (DV-09)
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: [...configDefaults.exclude, '.next/**'],
    // TESTING §7: `npm run test:cov`. Every source file counts, imported by a test or not.
    coverage: {
      provider: 'v8',
      include: ['app/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}', 'i18n/**/*.{ts,tsx}', 'proxy.ts'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts'],
      reporter: ['text-summary', 'text', 'lcov'],
      thresholds: {
        // A floor at the coverage measured when the gate was introduced (rounded down), not the
        // target: TESTING §7 sets 80% lines and branches. The floor is ratcheted up toward 80%
        // and tracked in #57; it never goes down.
        lines: 24,
        branches: 22,
      },
    },
  },
});
