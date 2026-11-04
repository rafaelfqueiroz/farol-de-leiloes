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
        // TESTING §7: floor rounded down from measured coverage, ratcheted up by #58.
        // The target remains 80% lines and branches (#57); the floor never goes down.
        lines: 49,
        branches: 45,
      },
    },
  },
});
