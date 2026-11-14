// AR-38: every error leaves the API as { code, context } with the catalogue's status, through
// the real Nest + Express stack and the app's own setup (configureApp). supertest binds an
// ephemeral loopback port in this process; nothing leaves the machine (TS-01).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { captureException } from '@sentry/nestjs';
import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  type INestApplication,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import { IsInt, IsString, ValidateNested } from 'class-validator';
import request from 'supertest';
import { configureApp } from '../../app.setup.js';
import { testConfigService } from '../../../test/support/test-env.js';
import { ERROR_CODES, type ErrorCode } from './codes.js';
import { DomainError } from './domain-error.js';
import { ERROR_STATUS } from './error-status.js';

// TS-03: the Sentry SDK has no port of ours (the filter calls it directly, ARCHITECTURE §9), so
// it is replaced with vi.mock to observe what the filter reports; nothing is sent either way
// (TS-07), since Sentry is never initialised in tests.
vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn() }));

// Fake personal data the responses and logs must never echo (TS-27).
const SECRET = 'ana.souza@example.test';

class AddressDto {
  @IsString()
  city!: string;
}

class ProfileDto {
  @IsString()
  name!: string;

  @IsInt()
  age!: number;

  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;
}

@Controller('probe')
class ProbeController {
  @Get('domain/:code')
  domain(@Param('code') code: string): never {
    throw new DomainError(
      code as ErrorCode,
      code === 'SAVED_FILTER_LIMIT_REACHED' ? { limit: 10 } : {},
    );
  }

  @Post('profile')
  profile(@Body() body: ProfileDto): ProfileDto {
    return body;
  }

  @Get('fault')
  fault(): never {
    throw new Error(`E11000 duplicate key error: { email: "${SECRET}" }`);
  }

  @Get('forbidden')
  forbidden(): never {
    throw new ForbiddenException(`no access for ${SECRET}`);
  }

  @Get('conflict')
  conflict(): never {
    throw new ConflictException(SECRET);
  }
}

describe('ApiExceptionFilter over HTTP', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [{ provide: ConfigService, useValue: testConfigService() }],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it.each(ERROR_CODES)(
    'answers a DomainError %s with its status and { code, context }',
    async (code) => {
      const response = await http().get(`/api/probe/domain/${code}`);

      expect(response.status).toBe(ERROR_STATUS[code]);
      expect(response.body).toEqual({
        code,
        context: code === 'SAVED_FILTER_LIMIT_REACHED' ? { limit: 10 } : {},
      });
    },
  );

  it('answers a refused DTO with VALIDATION_FAILED naming the fields, never their values', async () => {
    const response = await http()
      .post('/api/probe/profile')
      .send({ name: 42, age: SECRET, address: { city: 7 }, extra: SECRET });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect([...response.body.context.fields].sort()).toEqual(
      ['address.city', 'age', 'extra', 'name'].sort(),
    );
    expect(response.text).not.toContain(SECRET);
  });

  it('answers a malformed JSON body with BAD_REQUEST', async () => {
    const response = await http()
      .post('/api/probe/profile')
      .set('Content-Type', 'application/json')
      .send(`{"name": "${SECRET}"`);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'BAD_REQUEST', context: {} });
  });

  it('answers a body over the parser limit with PAYLOAD_TOO_LARGE', async () => {
    const response = await http()
      .post('/api/probe/profile')
      .send({ name: 'x'.repeat(200 * 1024) });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ code: 'PAYLOAD_TOO_LARGE', context: {} });
  });

  it('answers an unknown route with NOT_FOUND', async () => {
    const response = await http().get('/api/no-such-route');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ code: 'NOT_FOUND', context: {} });
  });

  it('maps a built-in HttpException to its generic code, dropping its message', async () => {
    const response = await http().get('/api/probe/forbidden');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ code: 'FORBIDDEN', context: {} });
  });

  it('answers a built-in 4xx with no generic code as BAD_REQUEST', async () => {
    const response = await http().get('/api/probe/conflict');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'BAD_REQUEST', context: {} });
  });

  it('answers an unexpected error with a bare 500 and logs it without its message', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error');

    const response = await http().get('/api/probe/fault');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ code: 'INTERNAL_ERROR', context: {} });
    expect(response.text).not.toContain('E11000');
    expect(response.text).not.toContain('stack');
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0]?.[0]).toBe('Unhandled Error on GET /api/probe/fault');
    expect(JSON.stringify(logged.mock.calls)).not.toContain(SECRET);
  });

  it('reports a fault to Sentry tagged with the method and route pattern only (AR-47)', async () => {
    await http().get('/api/probe/fault?email=ana.souza%40example.test').expect(500);

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { method: 'GET', route: '/api/probe/fault' },
    });
  });

  it('reports no client error or domain outcome to Sentry', async () => {
    await http().get('/api/probe/forbidden').expect(403);
    await http().get('/api/probe/domain/NOT_FOUND').expect(404);
    await http().get('/api/no-such-route').expect(404);

    expect(captureException).not.toHaveBeenCalled();
  });

  it('echoes a request id on every response, errors included (AR-46)', async () => {
    const response = await http().get('/api/probe/fault').set('x-request-id', 'bff-0123-abcd');
    expect(response.headers['x-request-id']).toBe('bff-0123-abcd');
  });
});
