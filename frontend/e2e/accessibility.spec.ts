// TS-23, BR-003-14, BR-003-17, DS-22: axe on every route, WCAG 2.1 A and AA, in the light and the
// dark scheme, on the desktop and the 360 px projects. Rules are never relaxed to pass: a known
// failure is marked against its issue below and fixed there.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ROUTES } from './support/routes';
import { openRoute } from './support/session';

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Known failures, by `path scheme`, each tracked by an issue (DV-23). The case is skipped with
 * test.fixme until the issue lands, then its entry is removed here.
 */
const KNOWN_FAILURES: Readonly<Record<string, string>> = {
  // color-contrast: dimmed "coming soon" plan cards (opacity 0.7), light scheme only.
  '/ light': '#139',
  '/plans light': '#139',
};

for (const route of ROUTES) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`axe: ${route.name} (${route.path}) in ${colorScheme}`, async ({ page }) => {
      const issue = KNOWN_FAILURES[`${route.path} ${colorScheme}`];
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
    });
  }
}
