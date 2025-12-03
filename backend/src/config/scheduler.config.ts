import { registerAs } from "@nestjs/config"

export interface SchedulerConfig {
	import: SchedulerImportConfig
}

export interface SchedulerImportConfig {
	enabled: boolean
	runMode: 'AUTO' | 'MANUAL'
}

export const KEY = 'SchedulerConfig'

export default registerAs(KEY, () => ({
  import: {
		enabled: process.env.IMPORT_ENABLED !== 'false',
		runMode: (process.env.IMPORT_RUN_MODE || 'AUTO') as 'AUTO' | 'MANUAL'
	}
} satisfies SchedulerConfig))