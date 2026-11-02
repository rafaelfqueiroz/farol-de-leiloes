import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { errorMessage } from './common/error-message';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Enable CORS
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    credentials: true,
  });

  // Enable validation pipes globally
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api');
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}

// A failed boot is logged (AR-45) and exits non-zero, as the unhandled rejection did before.
bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error(
    `Failed to start: ${errorMessage(error)}`,
    error instanceof Error ? error.stack : undefined,
  );
  process.exit(1);
});
