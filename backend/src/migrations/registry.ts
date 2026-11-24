// AR-29: every migration, in the order it applies. A new one is appended here, never inserted
// before an existing one, and an applied one is never edited or removed (forward-only): the
// runner refuses a list out of order (migration-runner.ts).
import { moneyDecimal128 } from './0001-money-decimal128.migration.js';
import { savedFilterPriceBounds } from './0002-saved-filter-price-bounds.migration.js';
import { accountTokens } from './0003-account-tokens.migration.js';
import { adminCapability } from './0004-admin-capability.migration.js';
import { adminAccessIndexes } from './0005-admin-access-indexes.migration.js';
import { subscriptionIndexes } from './0006-subscription-indexes.migration.js';
import { billingIndexes } from './0007-billing-indexes.migration.js';
import { consentIndexes } from './0008-consent-indexes.migration.js';
import { privacyRightsIndexes } from './0009-privacy-rights-indexes.migration.js';
import { retentionLegalIndexes } from './0010-retention-legal-indexes.migration.js';
import { eraseLegacyProfileFieldsMigration } from './0011-erase-legacy-profile-fields.migration.js';
import { supportRequestsIndexes } from './0012-support-requests-indexes.migration.js';
import { accountStatusEventsIndexes } from './0013-account-status-events-indexes.migration.js';
import type { Migration } from './migration.js';

export const MIGRATIONS: readonly Migration[] = [
  moneyDecimal128,
  savedFilterPriceBounds,
  accountTokens,
  adminCapability,
  adminAccessIndexes,
  subscriptionIndexes,
  billingIndexes,
  consentIndexes,
  privacyRightsIndexes,
  retentionLegalIndexes,
  eraseLegacyProfileFieldsMigration,
  supportRequestsIndexes,
  accountStatusEventsIndexes,
];
