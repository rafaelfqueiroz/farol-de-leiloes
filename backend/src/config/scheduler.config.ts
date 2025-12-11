import { registerAs } from "@nestjs/config"

export interface SchedulerConfig {
	import: SchedulerImportConfig
	scraper: SchedulerScraperConfig
}

export interface SchedulerImportConfig {
	enabled: boolean
	onStartup: boolean
}

export interface SchedulerScraperConfig {
	enabled: boolean
	onStartup: boolean
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
	}
} satisfies SchedulerConfig))