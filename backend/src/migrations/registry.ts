// AR-29: every migration, in the order it applies. A new one is appended here, never inserted
// before an existing one, and an applied one is never edited or removed (forward-only): the
// runner refuses a list out of order (migration-runner.ts).
import { moneyDecimal128 } from './0001-money-decimal128.migration.js';
import { savedFilterPriceBounds } from './0002-saved-filter-price-bounds.migration.js';
import type { Migration } from './migration.js';

export const MIGRATIONS: readonly Migration[] = [moneyDecimal128, savedFilterPriceBounds];
