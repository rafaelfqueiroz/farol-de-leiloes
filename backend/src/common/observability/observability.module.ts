// ARCHITECTURE §11: nestjs-pino behind every NestJS Logger (AR-45), configured from the validated
// environment (AR-41). main.ts hands it to Nest with app.useLogger; specs never import this module
// and stay silent through test/support/silence-logger.ts.
import { Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { AppConfigService, Env } from '../../config/env.js';
import { loggerParams } from './logger-options.js';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: AppConfigService) =>
        loggerParams(config.get('LOG_LEVEL', { infer: true })),
    }),
  ],
})
export class ObservabilityModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(ObservabilityModule.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  onApplicationBootstrap(): void {
    warnWithoutSentry(this.config, this.logger);
  }
}

/** AR-47: production without a DSN reports no fault anywhere; say so once, at boot. */
export function warnWithoutSentry(config: AppConfigService, logger: Pick<Logger, 'warn'>): void {
  if (
    config.get('NODE_ENV', { infer: true }) === 'production' &&
    !config.get('SENTRY_DSN', { infer: true })
  ) {
    logger.warn('SENTRY_DSN is not set: faults are logged but not reported to Sentry (AR-47)');
  }
}
