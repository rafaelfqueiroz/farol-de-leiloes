// TESTING §6, TS-21..TS-23: Playwright against the E2E Compose stack (e2e/compose.e2e.yml), which
// e2e/global-setup.ts brings up and tears down. Specs live in e2e/ as *.spec.ts, which the
// Vitest projects never collect (they take *.test.ts[x] only).
import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = process.env.E2E_WEB_PORT ?? '38101';
const CI = Boolean(process.env.CI);

// The specs that run per viewport; the time-zone check runs only in its own projects.
const TIME_ZONE_SPECS = /brasilia-time\.spec\.ts/;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: CI,
  // TS-31: a failing check is fixed, not retried.
  retries: 0,
  workers: CI ? 2 : 4,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // TS-23 / BR-003-12: every page on a desktop viewport and a 360 px phone.
    {
      name: 'desktop',
      testIgnore: TIME_ZONE_SPECS,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'phone-360',
      testIgnore: TIME_ZONE_SPECS,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 360, height: 740 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
    // BR-003-23: the property page shows Brasília time whatever the browser's zone.
    {
      name: 'tz-manaus',
      testMatch: TIME_ZONE_SPECS,
      use: { ...devices['Desktop Chrome'], timezoneId: 'America/Manaus' },
    },
    {
      name: 'tz-lisbon',
      testMatch: TIME_ZONE_SPECS,
      use: { ...devices['Desktop Chrome'], timezoneId: 'Europe/Lisbon' },
    },
  ],
});
