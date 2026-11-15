// HTTP contract of POST /api/ai/extract-params (TESTING §2): public, validates the message, and
// answers the parameters with prices as money strings (AR-17), with NlpService stubbed so no LLM
// is called (TS-07).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AiController } from './ai.controller.js';
import { NlpService } from './services/nlp.service.js';
import { Decimal } from '../common/money/money.js';
import { createHttpApp } from '../../test/support/http-app.js';

describe('AiController over HTTP', () => {
  const nlp = { extractQueryParams: vi.fn() };
  let app: INestApplication;

  beforeAll(async () => {
    app = await createHttpApp({
      controllers: [AiController],
      providers: [{ provide: NlpService, useValue: nlp }],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    nlp.extractQueryParams.mockResolvedValue({
      state: 'RN',
      city: 'Natal',
      maxPrice: new Decimal('300000'),
      page: 2,
    });
  });

  it('answers the extracted parameters, a price as a reais string and absent ones omitted', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ai/extract-params')
      .send({ message: 'casas em Natal até 300 mil' })
      .expect(201);

    expect(nlp.extractQueryParams).toHaveBeenCalledWith('casas em Natal até 300 mil');
    expect(res.body).toEqual({ state: 'RN', city: 'Natal', maxPrice: '300000.00', page: 2 });
  });

  it.each([
    ['an empty message', { message: '' }],
    ['a message that is not text', { message: 42 }],
    ['no message', {}],
  ])('refuses %s with 400 before the model is asked', async (_name, body) => {
    await request(app.getHttpServer()).post('/api/ai/extract-params').send(body).expect(400);

    expect(nlp.extractQueryParams).not.toHaveBeenCalled();
  });
});
