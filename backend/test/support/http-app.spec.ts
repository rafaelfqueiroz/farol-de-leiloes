// SC-07 / TS-01: public HTTP controller tests must reproduce anonymous production requests.
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Public } from '../../src/auth/decorators/public.decorator';
import { CurrentUser } from '../../src/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../src/auth/interfaces/auth.interface';
import { createHttpApp, TEST_USER } from './http-app';

@Controller('test-auth')
class MixedController {
  @Get('protected')
  protectedRoute(@CurrentUser() user: AuthenticatedUser) {
    return { userId: user.userId };
  }

  @Public()
  @Get('public')
  publicRoute(@CurrentUser() user: AuthenticatedUser | undefined) {
    return { userId: user?.userId ?? null };
  }
}

@Public()
@Controller('test-public')
class PublicController {
  @Get()
  publicRoute(@CurrentUser() user: AuthenticatedUser | undefined) {
    return { userId: user?.userId ?? null };
  }
}

describe('createHttpApp authentication stand-in', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createHttpApp({ controllers: [MixedController, PublicController] });
  });
  afterAll(async () => app.close());

  it.each(['/api/test-auth/public', '/api/test-public'])(
    'keeps @Public handlers and controllers anonymous: %s',
    async (path) => {
      const response = await request(app.getHttpServer()).get(path).expect(200);
      expect(response.body).toEqual({ userId: null });
    },
  );

  it('still signs the configured fake user into protected routes', async () => {
    const response = await request(app.getHttpServer()).get('/api/test-auth/protected').expect(200);
    expect(response.body).toEqual({ userId: TEST_USER.userId });
  });
});
