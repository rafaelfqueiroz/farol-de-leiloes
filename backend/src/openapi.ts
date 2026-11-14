// AR-33: the OpenAPI document is the API reference; there is no hand-written route table. Built
// from the controller and DTO decorators (no CLI plugin: every property is decorated explicitly)
// and served at /api/docs outside production only, so production does not publish its surface.
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { BEARER_AUTH } from './auth/decorators/api-jwt-auth.decorator.js';

/** Served under the global prefix: the UI at /api/docs, the JSON at /api/docs-json. */
export const OPENAPI_PATH = 'api/docs';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Farol dos Leilões API')
    .setDescription(
      'Errors answer { code, context } with a code from ErrorCode (AR-38). Lists are paginated ' +
        'with page and pageSize (max 100) and answer { items, total, page, pageSize } (AR-35).',
    )
    .setVersion('0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, BEARER_AUTH)
    .build();
  return SwaggerModule.createDocument(app, config);
}

/** Mounts the UI and JSON; the document is built on the first request, not at boot. */
export function serveOpenApiDocs(app: INestApplication): void {
  SwaggerModule.setup(OPENAPI_PATH, app, () => createOpenApiDocument(app));
}
