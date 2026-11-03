// The HTTP surface every app instance shares: main.ts and the HTTP-level specs both call
// configureApp, so a spec exercises the same prefix, validation and error shape production does.
import { type INestApplication, ValidationPipe, type ValidationError } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { DomainError } from './common/errors/domain-error';
import type { AppConfigService } from './config/env';
import { serveOpenApiDocs } from './openapi';

export function configureApp(app: INestApplication): void {
  const config = app.get<AppConfigService>(ConfigService);

  app.setGlobalPrefix('api'); // AR-32

  app.enableCors({
    origin: config.get('FRONTEND_URL', { infer: true }),
    credentials: true,
  });

  // AR-34: every body and query is a whitelisted, transformed DTO. A refusal is a
  // VALIDATION_FAILED naming the offending properties only, never their values (AR-40).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new DomainError('VALIDATION_FAILED', { fields: propertyPaths(errors) }),
    }),
  );

  // AR-38: one filter shapes every error response as { code, context }.
  app.useGlobalFilters(new ApiExceptionFilter());

  // AR-33: the OpenAPI reference at /api/docs, after the prefix so its paths carry /api. Not in
  // production: the deployed API does not publish a map of its own surface.
  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    serveOpenApiDocs(app);
  }
}

/** `address.city` for a nested DTO; each path once. */
export function propertyPaths(errors: ValidationError[], parent = ''): string[] {
  const paths = errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    const children = error.children ?? [];
    const failsItself = Object.keys(error.constraints ?? {}).length > 0 || children.length === 0;
    return [...(failsItself ? [path] : []), ...propertyPaths(children, path)];
  });
  return [...new Set(paths)];
}
