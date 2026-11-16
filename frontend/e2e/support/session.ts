// Signs a seeded account in the way the app does — POST /api/auth/login through the BFF — without
// driving the sign-in form on every page. The BFF answers with `{ user }` and sets the session
// cookie (SC-02): httpOnly, so no script reads it, and `__Host-` + Secure in this production
// build (Chromium accepts Secure cookies on http://localhost). `page.request` shares the browser
// context's cookie jar, so the page that opens next is signed in with no token anywhere in the
// test. The form itself is the SPEC-001 journey's to test (TESTING §6).
import { expect, test, type Page } from '@playwright/test';
import { ACCOUNTS } from './accounts';
import type { AppRoute, Audience } from './routes';

async function signIn(page: Page, as: Exclude<Audience, 'public'>) {
  // SC-02: the BFF refuses a state-changing request whose Origin is not the site's own
  // (NEXT_PUBLIC_SITE_URL, which compose.e2e.yml sets to the origin Playwright uses). A browser
  // sends it by itself; this request does not.
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error('playwright.config.ts must set use.baseURL');
  const origin = new URL(baseURL).origin;
  const response = await page.request.post('/api/auth/login', {
    data: ACCOUNTS[as],
    headers: { Origin: origin },
  });
  expect(response.status(), `sign-in of the seeded ${as}`).toBe(200);
  expect(await response.json(), 'the answer carries the user and no token').not.toHaveProperty(
    'accessToken',
  );
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
    await signIn(page, route.as);
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
