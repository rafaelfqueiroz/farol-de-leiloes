import { registerAs } from '@nestjs/config';
import { validateEnv, type Env } from './env.js';

/**
 * AR-43: the business values the specs call configurable, as typed settings with defaults.
 * Services inject this object and never hold the number themselves.
 */
export interface BusinessConfig {
  savedFilters: {
    /** Saved filters one user may keep (SPEC-007; the per-plan value is open in Q-15). */
    maxPerUser: number;
  };
  retention: {
    /** Days an unavailable auction is kept before the cleanup job removes it and its files. */
    unavailableAuctionDays: number;
  };
  subscriptions: {
    /** SPEC-012 BR-012-28: days a lapsed office keeps working before it turns read-only. */
    graceDays: number;
    /** SPEC-012 BR-012-29: days after the first confirmed payment with a full refund. */
    refundWindowDays: number;
  };
  privacy: {
    /** SPEC-010 BR-010-15: the legal ceiling for deleting a closed account's personal data. */
    accountPurgeMaxDays: number;
    /** SPEC-010 BR-010-15: days after closure at which an unpurged account raises an alert. */
    accountPurgeAlertDays: number;
    /** SPEC-010 BR-010-11: days an export stays downloadable after it became ready. */
    exportTtlDays: number;
    /**
     * SPEC-010 BR-010-18, BR-010-24: whole years a closed journey's documents are kept after its
     * closing date. Provisional until the lawyer's validation is recorded (BR-010-26).
     */
    documentRetentionYears: number;
  };
  import: {
    /** SPEC-004 BR-004-04: least share (0-1] of the last applied list's rows a new list must hold. */
    minRowRatio: number;
  };
  calendar: {
    /** SPEC-004 BR-004-31: national holidays as sorted `YYYY-MM-DD` Brasília days; may be empty. */
    nationalHolidays: readonly string[];
  };
}

export const KEY = 'BusinessConfig';

/** The business settings out of the validated environment (AR-41, AR-43). */
export function businessConfigFrom(env: Env): BusinessConfig {
  return {
    savedFilters: { maxPerUser: env.SAVED_FILTERS_MAX_PER_USER },
    retention: { unavailableAuctionDays: env.UNAVAILABLE_AUCTION_RETENTION_DAYS },
    subscriptions: {
      graceDays: env.SUBSCRIPTION_GRACE_DAYS,
      refundWindowDays: env.REFUND_WINDOW_DAYS,
    },
    privacy: {
      accountPurgeMaxDays: env.ACCOUNT_PURGE_MAX_DAYS,
      accountPurgeAlertDays: env.ACCOUNT_PURGE_ALERT_DAYS,
      exportTtlDays: env.EXPORT_TTL_DAYS,
      documentRetentionYears: env.DOCUMENT_RETENTION_YEARS,
    },
    import: { minRowRatio: env.IMPORT_MIN_ROW_RATIO },
    calendar: { nationalHolidays: env.NATIONAL_HOLIDAYS },
  };
}

// AR-42: the config module is the only reader of process.env.
export default registerAs(KEY, (): BusinessConfig => businessConfigFrom(validateEnv(process.env)));
