// AR-47: Sentry first, before any module it instruments is loaded. Under native ESM every static
// import below is loaded before this file's body runs, so `npm start`, `start:dev` and the image
// preload it with `node --import ./dist/instrument.js` (#63); this import keeps a plain
// `node dist/main.js` initialising Sentry too, just without the module hooks.
import './instrument.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { jobErrorCode } from './common/services/job-error-code.js';
import { stackFrames } from './common/observability/logger-options.js';
import type { AppConfigService } from './config/env.js';

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
