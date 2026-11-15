// HTTP contract of POST /api/support (TESTING §2): body validation and the sender being the
// signed-in user, with SupportService stubbed.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SupportController } from './support.controller.js';
import { SupportService } from './support.service.js';
import { createHttpApp, TEST_USER } from '../../test/support/http-app.js';

describe('SupportController over HTTP', () => {
  const support = { submitSupportRequest: vi.fn() };
  let app: INestApplication;

  beforeAll(async () => {
    app = await createHttpApp({
      controllers: [SupportController],
      providers: [{ provide: SupportService, useValue: support }],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    support.submitSupportRequest.mockResolvedValue({ message: 'Enviado.' });
  });

  it('sends the request as the signed-in user and answers 200 with the service message', async () => {
    const body = { title: 'Cannot log in', description: 'The login page keeps failing for me.' };

    const res = await request(app.getHttpServer()).post('/api/support').send(body).expect(200);

    expect(res.body).toEqual({ message: 'Enviado.' });
    expect(support.submitSupportRequest).toHaveBeenCalledWith(
      TEST_USER.userId,
      TEST_USER.email,
      TEST_USER.name,
      body,
    );
  });

  it.each([
    ['a title under 3 characters', { title: 'ab', description: 'long enough description' }],
    ['a title over 200 characters', { title: 'x'.repeat(201), description: 'long enough text' }],
    ['a description under 10 characters', { title: 'Valid title', description: 'short' }],
    ['a description over 2000 characters', { title: 'Valid title', description: 'x'.repeat(2001) }],
    ['a missing description', { title: 'Valid title' }],
  ])('refuses %s with 400', async (_name, body) => {
    await request(app.getHttpServer()).post('/api/support').send(body).expect(400);

    expect(support.submitSupportRequest).not.toHaveBeenCalled();
  });
});
