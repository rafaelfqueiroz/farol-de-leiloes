// AR-33..AR-36: the OpenAPI document is the API reference, so it is held to a contract here
// instead of by review. The document is built from every controller in src/ (found on disk, so a
// new controller is checked the day it lands) with their services mocked, and the specs assert:
//   - every operation has a summary and a typed success response;
//   - routes behind JwtAuthGuard declare the bearer scheme and 401, public routes do not;
//   - every @Body/@Query is a whole, class-validator DTO whose validated properties are all
//     documented (AR-34), except the Stripe webhook, which reads the raw body by design;
//   - list endpoints answer the paginated envelope and no endpoint answers a bare array (AR-35);
//   - the docs are served at /api/docs, except in production.
// supertest binds an ephemeral loopback port in this process; nothing leaves the machine (TS-01).
import 'reflect-metadata';
import { readdirSync } from 'fs';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication, Type } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DECORATORS, type OpenAPIObject } from '@nestjs/swagger';
import { getMetadataStorage } from 'class-validator';
import request from 'supertest';
import { configureApp } from './app.setup';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { createOpenApiDocument } from './openapi';
import { testConfigService } from '../test/support/test-env';

type Operation = OpenAPIObject['paths'][string]['get'] & object;
type Schema = Record<string, unknown>;

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Browser redirects, documented with their 302 instead of a body. */
const REDIRECT_OPERATIONS = ['AuthController_googleAuth', 'AuthController_googleAuthRedirect'];

/** AR-34 exemption: Stripe signs the exact bytes, so the webhook reads the raw body. */
const RAW_BODY_OPERATIONS = ['PaymentsController_handleWebhook'];

/** AR-35: the browsable lists. */
const PAGINATED = [
  'get /api/auctions',
  'get /api/favorites',
  'get /api/reminders',
  'get /api/saved-filters',
  'get /api/coupons',
];

const BUILT_IN_TYPES: unknown[] = [String, Number, Boolean, Date, Object, Array];

/** The JSON schema of a documented response, if it has one. */
function jsonSchemaOf(response: unknown): Schema | undefined {
  const content = (response as { content?: Record<string, { schema?: Schema }> } | undefined)
    ?.content;
  return content?.['application/json']?.schema;
}

async function findControllers(): Promise<Type<unknown>[]> {
  const files = (readdirSync(__dirname, { recursive: true }) as string[]).filter((file) =>
    file.endsWith('.controller.ts'),
  );
  const modules = await Promise.all(
    files.map((file) => import(join(__dirname, file)) as Promise<Record<string, unknown>>),
  );
  return modules
    .flatMap((exports) => Object.values(exports))
    .filter(
      (value): value is Type<unknown> =>
        typeof value === 'function' && Reflect.hasMetadata(PATH_METADATA, value),
    );
}

async function createApp(
  controllers: Type<unknown>[],
  env: Record<string, string> = {},
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers,
    providers: [{ provide: ConfigService, useValue: testConfigService(env) }],
  })
    .useMocker(() => ({}))
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

function handlersOf(controller: Type<unknown>): string[] {
  const proto = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto).filter(
    (name) => name !== 'constructor' && typeof proto[name] === 'function',
  );
}

/** Each @Body()/@Query() of a handler: its metatype and whether it names one property. */
function bodyAndQueryParams(controller: Type<unknown>, handler: string) {
  const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handler) ?? {}) as Record<
    string,
    { index: number; data?: unknown }
  >;
  const types = (Reflect.getMetadata('design:paramtypes', controller.prototype, handler) ??
    []) as unknown[];
  return Object.entries(args)
    .filter(([key]) =>
      [`${RouteParamtypes.BODY}:`, `${RouteParamtypes.QUERY}:`].some((prefix) =>
        key.startsWith(prefix),
      ),
    )
    .map(([key, arg]) => ({ key, data: arg.data, metatype: types[arg.index] }));
}

function documentedProperties(dto: Type<unknown>): string[] {
  const names = (Reflect.getMetadata(DECORATORS.API_MODEL_PROPERTIES_ARRAY, dto.prototype) ??
    []) as string[];
  return names.map((name) => name.replace(/^:/, ''));
}

function validatedProperties(dto: Type<unknown>): string[] {
  const metadatas = getMetadataStorage().getTargetValidationMetadatas(dto, '', true, false);
  return [...new Set(metadatas.map((metadata) => metadata.propertyName))];
}

/** The DTO classes a DTO's documented properties point at (`type: () => Nested`). */
function nestedDtos(dto: Type<unknown>): Type<unknown>[] {
  return documentedProperties(dto).flatMap((name) => {
    const options = Reflect.getMetadata(DECORATORS.API_MODEL_PROPERTIES, dto.prototype, name) as
      { type?: unknown } | undefined;
    let type = options?.type;
    // A lazy `() => Nested` has no prototype; a class does.
    if (typeof type === 'function' && !type.prototype) type = (type as () => unknown)();
    if (Array.isArray(type)) type = type[0];
    return typeof type === 'function' && !BUILT_IN_TYPES.includes(type)
      ? [type as Type<unknown>]
      : [];
  });
}

/** AR-34 for one DTO and every DTO nested in it: validated, and every validated field documented. */
function expectDecoratedDto(dto: Type<unknown>, where: string, seen = new Set<unknown>()): void {
  if (seen.has(dto)) return;
  seen.add(dto);
  const validated = validatedProperties(dto);
  expect(validated.length, `${where}: ${dto.name} has no class-validator rules`).toBeGreaterThan(0);
  expect(
    validated.filter((name) => !documentedProperties(dto).includes(name)),
    `${where}: ${dto.name} properties without @ApiProperty`,
  ).toEqual([]);
  for (const nested of nestedDtos(dto)) expectDecoratedDto(nested, where, seen);
}

describe('OpenAPI document (AR-33)', () => {
  let controllers: Type<unknown>[];
  let app: INestApplication;
  let document: OpenAPIObject;
  let operations: { method: string; path: string; operation: Operation }[];

  beforeAll(async () => {
    controllers = await findControllers();
    app = await createApp(controllers);
    document = createOpenApiDocument(app);
    operations = Object.entries(document.paths).flatMap(([path, item]) =>
      HTTP_METHODS.flatMap((method) => {
        const operation = item[method];
        return operation ? [{ method, path, operation }] : [];
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  function operationById(operationId: string): Operation {
    const found = operations.find(({ operation }) => operation.operationId === operationId);
    if (!found) throw new Error(`No operation ${operationId}`);
    return found.operation;
  }

  it('finds every controller and documents their routes', () => {
    expect(controllers.length).toBeGreaterThanOrEqual(9);
    expect(operations.length).toBeGreaterThanOrEqual(40);
  });

  it('gives every operation a summary', () => {
    const missing = operations
      .filter(({ operation }) => !operation.summary?.trim())
      .map(({ method, path }) => `${method} ${path}`);
    expect(missing).toEqual([]);
  });

  it('gives every operation a typed success response (204 has no body, redirects are 302)', () => {
    const untyped = operations.filter(({ operation }) => {
      const id = operation.operationId ?? '';
      if (REDIRECT_OPERATIONS.includes(id)) return !operation.responses['302'];
      if (operation.responses['204']) return false;
      const success = Object.entries(operation.responses).find(([status]) =>
        /^2\d\d$/.test(status),
      );
      const schema = jsonSchemaOf(success?.[1]);
      return !schema || !(schema.$ref || schema.allOf);
    });
    expect(untyped.map(({ method, path }) => `${method} ${path}`)).toEqual([]);
  });

  it('documents the { code, context } error shape on every operation (AR-38)', () => {
    const errorRef = '#/components/schemas/ErrorResponseDto';
    const missing = operations.filter(({ operation }) =>
      ['400', '500', 'default'].some(
        (status) => jsonSchemaOf(operation.responses[status])?.$ref !== errorRef,
      ),
    );
    expect(missing.map(({ method, path }) => `${method} ${path}`)).toEqual([]);
  });

  it('declares bearer auth and 401 exactly on the routes behind JwtAuthGuard', () => {
    const mismatched = controllers.flatMap((controller) =>
      handlersOf(controller).flatMap((handler) => {
        const guards = [
          ...((Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as unknown[]),
          ...((Reflect.getMetadata(GUARDS_METADATA, controller.prototype[handler]) ??
            []) as unknown[]),
        ];
        const guarded = guards.includes(JwtAuthGuard);
        const operation = operationById(`${controller.name}_${handler}`);
        const documented =
          (operation.security ?? []).some((requirement) => 'bearer' in requirement) &&
          operation.responses['401'] !== undefined;
        return guarded === documented ? [] : [`${controller.name}.${handler}`];
      }),
    );
    expect(mismatched).toEqual([]);
  });

  it('takes every @Body and @Query as one whole, validated and documented DTO (AR-34)', () => {
    for (const controller of controllers) {
      for (const handler of handlersOf(controller)) {
        const where = `${controller.name}.${handler}`;
        for (const param of bodyAndQueryParams(controller, handler)) {
          expect(param.data, `${where}: @Body/@Query must take the whole DTO`).toBeUndefined();
          expect(BUILT_IN_TYPES, `${where}: ${param.key} is not a DTO class`).not.toContain(
            param.metatype,
          );
          expect(typeof param.metatype, `${where}: ${param.key} has no metatype`).toBe('function');
          expectDecoratedDto(param.metatype as Type<unknown>, where);
        }
      }
    }
  });

  it('exempts only the Stripe webhook from AR-34, documenting its raw body and signature', () => {
    for (const id of RAW_BODY_OPERATIONS) {
      const [controllerName, handler] = id.split('_') as [string, string];
      const controller = controllers.find((candidate) => candidate.name === controllerName);
      expect(controller && bodyAndQueryParams(controller, handler)).toEqual([]);

      const operation = operationById(id);
      expect(operation.requestBody).toBeDefined();
      expect(operation.parameters).toContainEqual(
        expect.objectContaining({ in: 'header', name: 'stripe-signature', required: true }),
      );
    }
  });

  it.each(PAGINATED)('answers %s with the paginated envelope (AR-35)', (route) => {
    const [method, path] = route.split(' ') as [(typeof HTTP_METHODS)[number], string];
    const operation = document.paths[path]?.[method];
    const schema = jsonSchemaOf(operation?.responses['200']) as { allOf: Schema[] };

    expect(schema.allOf[0]).toEqual({ $ref: '#/components/schemas/PaginatedResponseDto' });
    expect(schema.allOf[1]).toMatchObject({
      properties: { items: { type: 'array', items: { $ref: expect.any(String) } } },
    });
    expect(operation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ in: 'query', name: 'page' }),
        expect.objectContaining({
          in: 'query',
          name: 'pageSize',
          schema: expect.objectContaining({ maximum: 100 }),
        }),
      ]),
    );
  });

  it('never answers a bare array: an unbounded list is a bug (AR-35)', () => {
    const bareArrays = operations.filter(({ operation }) =>
      Object.values(operation.responses).some(
        (response) => jsonSchemaOf(response)?.type === 'array',
      ),
    );
    expect(bareArrays.map(({ method, path }) => `${method} ${path}`)).toEqual([]);
  });

  it('documents the error codes as the ErrorCode enum', () => {
    const schemas = document.components?.schemas as Record<string, Schema>;
    expect(schemas.ErrorCode).toMatchObject({
      enum: expect.arrayContaining(['VALIDATION_FAILED']),
    });
  });

  describe('serving (AR-33: non-production only)', () => {
    it('serves the UI at /api/docs and the JSON at /api/docs-json outside production', async () => {
      await request(app.getHttpServer())
        .get('/api/docs')
        .expect(200)
        .expect('Content-Type', /html/);
      const json = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
      expect(json.body.paths['/api/auctions']).toBeDefined();
    });

    it('does not serve the docs in production', async () => {
      const production = await createApp(controllers, { NODE_ENV: 'production' });
      try {
        await request(production.getHttpServer())
          .get('/api/docs')
          .expect(404, { code: 'NOT_FOUND', context: {} });
        await request(production.getHttpServer()).get('/api/docs-json').expect(404);
      } finally {
        await production.close();
      }
    });
  });
});
