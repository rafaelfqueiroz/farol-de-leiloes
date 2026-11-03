import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { errorMessage } from './common/error-message';
import type { AppConfigService } from './config/env';

async function bootstrap() {
  // rawBody: the Stripe webhook verifies its signature over the exact bytes received.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);
  await app.listen(app.get<AppConfigService>(ConfigService).get('PORT', { infer: true }));
}

// A failed boot is logged (AR-45) and exits non-zero, as the unhandled rejection did before. An
// invalid environment lands here too, naming the variables but never their values (AR-41).
bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error(
    `Failed to start: ${errorMessage(error)}`,
    error instanceof Error ? error.stack : undefined,
  );
  process.exit(1);
});
