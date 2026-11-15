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

/** Opens `route` as its audience and waits until the page has settled. */
export async function openRoute(page: Page, route: AppRoute): Promise<void> {
  if (route.as !== 'public') {
    const token = await tokenFor(page.request, route.as);
    await page.addInitScript((value) => window.localStorage.setItem('token', value), token);
  }
  await page.goto(route.path);
  await page.waitForLoadState('networkidle');
  // Client pages show a spinner while they load the account or their data.
  await expect(page.locator('[role="progressbar"]')).toHaveCount(0);
  if (route.as !== 'public') {
    expect(new URL(page.url()).pathname, 'a signed-in page must not bounce to /login').not.toBe(
      '/login',
    );
  }
}
