// SC-17: security headers and CORS apply through the same setup used by the API.
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHttpApp } from '../test/support/http-app';

@Controller('security-test')
class SecurityTestController {
  @Get()
  get() {
    return { ok: true };
  }
}

describe('API transport headers and CORS (SC-17)', () => {
  let app: INestApplication;
  const allowed = 'https://frontend.example.test';

  beforeAll(async () => {
    app = await createHttpApp(
      { controllers: [SecurityTestController] },
      { env: { FRONTEND_URL: `${allowed}/` } },
    );
  });

  afterAll(async () => app.close());

  it.each(['/api/security-test', '/api/missing-route'])(
    'adds helmet headers to success and error responses: %s',
    async (path) => {
      const response = await request(app.getHttpServer()).get(path);
      expect(response.headers['strict-transport-security']).toBe('max-age=15552000');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(response.headers['x-powered-by']).toBeUndefined();
    },
  );

  it('permits only the exact configured origin with credentials', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/security-test')
      .set('Origin', allowed)
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBe(allowed);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it.each(['https://evil.example.test', 'https://frontend.example.test.evil.test', 'null'])(
    'never allows an unlisted origin: %s',
    async (origin) => {
      const response = await request(app.getHttpServer())
        .options('/api/security-test')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'GET');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    },
  );

  it('serves Swagger with same-origin external scripts allowed by its CSP', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs').expect(200);
    expect(response.text).toContain('swagger-ui-init.js');
    expect(response.text).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>\s*[^<\s]/i);
    expect(response.headers['content-security-policy']).toContain("script-src 'self'");
    expect(response.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    await request(app.getHttpServer()).get('/api/docs/swagger-ui-init.js').expect(200);
  });

  it('allows a preflight from the configured origin', async () => {
    const response = await request(app.getHttpServer())
      .options('/api/security-test')
      .set('Origin', allowed)
      .set('Access-Control-Request-Method', 'GET')
      .expect(204);
    expect(response.headers['access-control-allow-origin']).toBe(allowed);
  });
  it('SC-17: upgrades insecure resources in production without broadening HSTS to subdomains', async () => {
    const production = await createHttpApp(
      { controllers: [SecurityTestController] },
      { env: { NODE_ENV: 'production' } },
    );
    try {
      const response = await request(production.getHttpServer())
        .get('/api/security-test')
        .expect(200);
      expect(response.headers['content-security-policy']).toContain('upgrade-insecure-requests');
      expect(response.headers['strict-transport-security']).toBe('max-age=15552000');
    } finally {
      await production.close();
    }
  });
});
