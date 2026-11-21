import { registerAs } from '@nestjs/config';
import { validateEnv, type Env } from './env.js';

export interface SchedulerCleanupConfig {
  onStartup: boolean;
}

export interface SchedulerConfig {
  import: SchedulerImportConfig;
  scraper: SchedulerScraperConfig;
  cache: CacheConfig;
  reminders: SchedulerRemindersConfig;
  subscriptionsReconcile: SchedulerSubscriptionsReconcileConfig;
  accountPurge: SchedulerAccountPurgeConfig;
  dataExport: SchedulerDataExportConfig;
  documentRetention: SchedulerDocumentRetentionConfig;
  cleanup: SchedulerCleanupConfig;
}

export interface SchedulerRemindersConfig {
  enabled: boolean;
}

export interface SchedulerSubscriptionsReconcileConfig {
  enabled: boolean;
}

export interface SchedulerAccountPurgeConfig {
  enabled: boolean;
}

export interface SchedulerDataExportConfig {
  enabled: boolean;
}

export interface SchedulerDocumentRetentionConfig {
  enabled: boolean;
}

export interface SchedulerImportConfig {
  enabled: boolean;
  onStartup: boolean;
}

export interface SchedulerScraperConfig {
  enabled: boolean;
  onStartup: boolean;
}

export interface CacheConfig {
  neighborhoodsTtl: number;
  neighborhoodsEnabled: boolean;
}

export const KEY = 'SchedulerConfig';

/** The job and cache settings out of the validated environment (AR-41). */
export function schedulerConfigFrom(env: Env): SchedulerConfig {
  return {
    import: { enabled: env.IMPORT_ENABLED, onStartup: env.IMPORT_ON_START_UP },
    scraper: { enabled: env.SCRAPER_ENABLED, onStartup: env.SCRAPER_ON_START_UP },
    cache: {
      neighborhoodsTtl: env.NEIGHBORHOODS_CACHE_TTL,
      neighborhoodsEnabled: env.NEIGHBORHOODS_CACHE_ENABLED,
    },
    reminders: { enabled: env.REMINDERS_ENABLED },
    subscriptionsReconcile: { enabled: env.SUBSCRIPTIONS_RECONCILE_ENABLED },
    accountPurge: { enabled: env.ACCOUNT_PURGE_ENABLED },
    dataExport: { enabled: env.DATA_EXPORT_ENABLED },
    documentRetention: { enabled: env.DOCUMENT_RETENTION_ENABLED },
    cleanup: { onStartup: env.CLEANUP_ON_STARTUP },
  };
}

// AR-42: the config module is the only reader of process.env.
export default registerAs(KEY, () => schedulerConfigFrom(validateEnv(process.env)));
