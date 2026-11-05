// AR-47: Sentry first, before any module it instruments is loaded.
import './instrument';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { jobErrorCode } from './common/services/job-error-code';
import { stackFrames } from './common/observability/logger-options';
import type { AppConfigService } from './config/env';

async function bootstrap() {
  // rawBody: the Stripe webhook verifies its signature over the exact bytes received.
  // bufferLogs: the boot lines wait for the pino logger instead of going out unstructured (AR-45).
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  configureApp(app);
  await app.listen(app.get<AppConfigService>(ConfigService).get('PORT', { infer: true }));
}

// A failed boot is logged (AR-45) and exits non-zero, as the unhandled rejection did before. The
// line holds the error's stable code and frames, never its message (SC-15: a driver error may
// quote the connection string). An invalid environment stops the boot earlier, inside
// NestFactory.create, whose own line names the variables but never their values (AR-41).
bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error(
    `Failed to start: ${jobErrorCode(error)}`,
    error instanceof Error && error.stack ? stackFrames(error.stack) : undefined,
  );
  process.exit(1);
});
