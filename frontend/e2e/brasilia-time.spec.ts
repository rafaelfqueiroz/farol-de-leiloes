// BR-003-23, BR-003-25, BR-003-28: an auction Caixa publishes as "26/01/2026 - 10h00" shows that
// Brasília wall clock on the property page whatever the browser's zone. Runs only in the
// tz-manaus (UTC−4) and tz-lisbon (UTC+0 in January) projects, where a page that formatted in
// the device's zone would show 09:00 or 13:00.
import { expect, test } from '@playwright/test';
import { BRASILIA_TEN_AM_AUCTION } from './support/accounts';

const PROPERTY_PAGE = `/auction/${BRASILIA_TEN_AM_AUCTION}`;

test('the property page shows 26/01/2026 10:00 in Brasília time', async ({ page }) => {
  await page.goto(PROPERTY_PAGE);
  const main = page.locator('#app-content');
  await expect(main).toContainText('26/01/2026 10:00');
  await expect(main).not.toContainText('26/01/2026 09:00');
  await expect(main).not.toContainText('26/01/2026 13:00');
});

// BR-003-23: "where a time of day appears, it is marked as Brasília time". The marker lands with
// #3 slice A; this case turns on when it does.
test.fixme('the time of day is marked "(horário de Brasília)" (#3 slice A)', async ({ page }) => {
  await page.goto(PROPERTY_PAGE);
  await expect(page.locator('#app-content')).toContainText('10:00 (horário de Brasília)');
});
