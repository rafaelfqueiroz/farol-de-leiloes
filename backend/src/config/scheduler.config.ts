import { registerAs } from "@nestjs/config"

export interface SchedulerCleanupConfig {
	onStartup: boolean
}

export interface SchedulerConfig {
	import: SchedulerImportConfig
	scraper: SchedulerScraperConfig
	cache: CacheConfig
	reminders: SchedulerRemindersConfig
	cleanup: SchedulerCleanupConfig
}

export interface SchedulerRemindersConfig {
	enabled: boolean
}

export interface SchedulerImportConfig {
	enabled: boolean
	onStartup: boolean
}

export interface SchedulerScraperConfig {
	enabled: boolean
	onStartup: boolean
}

export interface CacheConfig {
	neighborhoodsTtl: number
	neighborhoodsEnabled: boolean
}

export const KEY = 'SchedulerConfig'

export default registerAs(KEY, () => ({
  import: {
		enabled: process.env.IMPORT_ENABLED !== 'false',
		onStartup: process.env.IMPORT_ON_START_UP === 'true'
	},
	scraper: {
		enabled: process.env.SCRAPER_ENABLED !== 'false',
		onStartup: process.env.SCRAPER_ON_START_UP === 'true'
	},
	cache: {
		neighborhoodsTtl: parseInt(process.env.NEIGHBORHOODS_CACHE_TTL || '600000', 10), // Default 5 minutes
		neighborhoodsEnabled: process.env.NEIGHBORHOODS_CACHE_ENABLED === 'true',
	},
	reminders: {
		enabled: process.env.REMINDERS_ENABLED !== 'false'
	},
	cleanup: {
		onStartup: process.env.CLEANUP_ON_STARTUP === 'true'
	}
} satisfies SchedulerConfig))