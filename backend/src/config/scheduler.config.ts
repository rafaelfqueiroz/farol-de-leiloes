import { registerAs } from '@nestjs/config';
import { validateEnv, type Env } from './env';

export interface SchedulerCleanupConfig {
  onStartup: boolean;
}

export interface SchedulerConfig {
  import: SchedulerImportConfig;
  scraper: SchedulerScraperConfig;
  cache: CacheConfig;
  reminders: SchedulerRemindersConfig;
  cleanup: SchedulerCleanupConfig;
}

export interface SchedulerRemindersConfig {
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
    cleanup: { onStartup: env.CLEANUP_ON_STARTUP },
  };
}

// AR-42: the config module is the only reader of process.env.
export default registerAs(KEY, () => schedulerConfigFrom(validateEnv(process.env)));
