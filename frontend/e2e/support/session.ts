// Signs a seeded account in the way the app does — POST /api/auth/login through the BFF, the
// token kept in localStorage (AuthContext) — without driving the sign-in form on every page.
// The form itself is the SPEC-001 journey's to test (TESTING §6).
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { ACCOUNTS } from './accounts';
import type { AppRoute, Audience } from './routes';

const tokens = new Map<Audience, string>();

async function tokenFor(request: APIRequestContext, as: Exclude<Audience, 'public'>) {
  const cached = tokens.get(as);
  if (cached) return cached;
  const response = await request.post('/api/auth/login', { data: ACCOUNTS[as] });
  expect(response.status(), `sign-in of the seeded ${as}`).toBe(200);
  const { accessToken } = (await response.json()) as { accessToken: string };
  tokens.set(as, accessToken);
  return accessToken;
}

/**
 * Fails unless the browser is on the page `route` means: its final pathname and its heading. Any
 * redirect, to /login or anywhere else, fails the case (TS-21).
 */
export async function expectOnRoute(page: Page, route: AppRoute): Promise<void> {
  expect(new URL(page.url()).pathname, `${route.path} must land on its own page`).toBe(
    route.landsOn ?? route.path,
  );
  // Visible, not only present: a page squeezed or covered at 360 px fails here even when the
  // document itself does not scroll sideways (BR-003-12).
  await expect(
    page.getByRole('heading', {
      name: route.heading,
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
}

/** Opens `route` as its audience, waits until the page has settled and checks it is the page. */
export async function openRoute(page: Page, route: AppRoute): Promise<void> {
  if (route.as !== 'public') {
    const token = await tokenFor(page.request, route.as);
    await page.addInitScript((value) => window.localStorage.setItem('token', value), token);
  }
  if (route.pauseClock) {
    // A one-second jump, then no time passes: the page's delayed redirect never fires.
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1_000));
  }
  await page.goto(route.path);
  await page.waitForLoadState('networkidle');
  // Client pages show a spinner while they load the account or their data.
  await expect(page.locator('[role="progressbar"]')).toHaveCount(0);
  await expectOnRoute(page, route);
  if (route.pauseClock) {
    // axe needs timers. The page's own delay starts counting only now, and every check
    // re-asserts the page when it finishes.
    await page.clock.resume();
  }
}
