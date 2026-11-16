// TS-23, BR-003-14, BR-003-17, DS-22: axe on every route, WCAG 2.1 A and AA, in the light and the
// dark scheme, on the desktop and the 360 px projects. Rules are never relaxed to pass: a known
// failure is marked against its issue in support/known-failures.ts and fixed there.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { knownFailure } from './support/known-failures';
import { ROUTES } from './support/routes';
import { expectOnRoute, openRoute } from './support/session';

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

for (const route of ROUTES) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`axe: ${route.name} (${route.path}) in ${colorScheme}`, async ({ page }, testInfo) => {
      const issue = knownFailure(route.path, 'axe', testInfo, colorScheme);
      test.fixme(Boolean(issue), `known failure, tracked by ${issue}`);
      await page.emulateMedia({ colorScheme });
      await openRoute(page, route);
      const results = await new AxeBuilder({ page }).withTags(WCAG_21_AA).analyze();
      // The rule ids and the elements, so a failure says what to fix.
      const violations = results.violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map((node) => node.target.join(' ')),
      }));
      expect(violations).toEqual([]);
      // Still the intended page: nothing redirected while the check ran.
      await expectOnRoute(page, route);
    });
  }
}
