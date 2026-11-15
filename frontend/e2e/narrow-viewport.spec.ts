// BR-003-12, DS-13: every screen is usable from 360 px wide without the page scrolling sideways.
// Runs in every viewport project; the phone-360 project is the one that matters.
import { expect, test } from '@playwright/test';
import { ROUTES } from './support/routes';
import { openRoute } from './support/session';

for (const route of ROUTES) {
  test(`no horizontal page scroll: ${route.name} (${route.path})`, async ({ page }) => {
    await openRoute(page, route);
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  });
}
