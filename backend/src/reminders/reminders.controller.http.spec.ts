// HTTP contract of the reminder commands (TESTING §2): validation of the bodies, status codes,
// the owner (the signed-in user, never a body field) handed to the service, and the response DTO,
// with RemindersService stubbed.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Types } from 'mongoose';
import { RemindersController } from './reminders.controller.js';
import { RemindersService } from './reminders.service.js';
import { ReminderChannel, ReminderStatus } from './schemas/reminder.schema.js';
import { DomainError } from '../common/errors/domain-error.js';
import { createHttpApp, TEST_USER } from '../../test/support/http-app.js';

// SPEC-002: the controller hands the service the request's AccessContext, built for the signed-in
// user (BR-002-11), never an id from the request.
const AS_TEST_USER = expect.objectContaining({ accountId: TEST_USER.userId });

const REMINDER = {
  _id: new Types.ObjectId('64b7f00000000000000000bb'),
  channel: ReminderChannel.SMS,
  scheduledAt: new Date('2026-02-01T09:00:00.000Z'),
  description: 'Bid before noon',
  status: ReminderStatus.PENDING,
  createdAt: new Date('2026-01-15T12:00:00.000Z'),
  auction: null, // the auction was removed: the DTO answers empty values
};
const EXPECTED = {
  _id: '64b7f00000000000000000bb',
  channel: 'SMS',
  scheduledAt: '2026-02-01T09:00:00.000Z',
  description: 'Bid before noon',
  status: 'PENDING',
  createdAt: '2026-01-15T12:00:00.000Z',
  auction: { _id: '', code: '', title: null, city: null, state: null, detailsUrl: null },
};

describe('RemindersController over HTTP', () => {
  const reminders = {
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  let app: INestApplication;

  beforeAll(async () => {
    app = await createHttpApp({
      controllers: [RemindersController],
      providers: [{ provide: RemindersService, useValue: reminders }],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    reminders.findOne.mockResolvedValue(REMINDER);
    reminders.create.mockResolvedValue(REMINDER);
    reminders.update.mockResolvedValue(REMINDER);
    reminders.delete.mockResolvedValue(undefined);
  });

  it('GET /api/reminders/:id answers the caller’s reminder as a response DTO', async () => {
    const res = await request(app.getHttpServer()).get('/api/reminders/abc').expect(200);

    expect(res.body).toEqual(EXPECTED);
    expect(reminders.findOne).toHaveBeenCalledWith(AS_TEST_USER, 'abc');
  });

  it('GET /api/reminders/:id answers 404 REMINDER_NOT_FOUND for a reminder that is not theirs', async () => {
    reminders.findOne.mockRejectedValue(new DomainError('REMINDER_NOT_FOUND'));

    const res = await request(app.getHttpServer()).get('/api/reminders/abc').expect(404);

    expect(res.body).toEqual({ code: 'REMINDER_NOT_FOUND', context: {} });
  });

  it('POST /api/reminders creates a reminder for the signed-in user (201)', async () => {
    const body = {
      auctionId: 'A1',
      channel: 'SMS',
      scheduledAt: '2026-02-01T09:00:00.000Z',
      description: 'Bid before noon',
    };

    const res = await request(app.getHttpServer()).post('/api/reminders').send(body).expect(201);

    expect(res.body).toEqual(EXPECTED);
    expect(reminders.create).toHaveBeenCalledWith(AS_TEST_USER, body);
  });

  it.each([
    ['an unknown channel', { channel: 'PIGEON' }],
    ['a scheduledAt that is not a date', { scheduledAt: 'tomorrow' }],
    ['a missing auctionId', { auctionId: undefined }],
    ['a description over 500 characters', { description: 'x'.repeat(501) }],
  ])('POST /api/reminders refuses %s with 400', async (_name, override) => {
    const body = {
      auctionId: 'A1',
      channel: 'EMAIL',
      scheduledAt: '2026-02-01T09:00:00.000Z',
      ...override,
    };

    await request(app.getHttpServer()).post('/api/reminders').send(body).expect(400);

    expect(reminders.create).not.toHaveBeenCalled();
  });

  it('PATCH /api/reminders/:id changes the reminder with the validated body', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/reminders/abc')
      .send({ description: 'new' })
      .expect(200);

    expect(res.body).toEqual(EXPECTED);
    expect(reminders.update).toHaveBeenCalledWith(AS_TEST_USER, 'abc', { description: 'new' });
  });

  it('PATCH /api/reminders/:id refuses a body with an invalid channel', async () => {
    await request(app.getHttpServer())
      .patch('/api/reminders/abc')
      .send({ channel: 'PIGEON' })
      .expect(400);

    expect(reminders.update).not.toHaveBeenCalled();
  });

  it('DELETE /api/reminders/:id answers 204 with no body', async () => {
    const res = await request(app.getHttpServer()).delete('/api/reminders/abc').expect(204);

    expect(res.text).toBe('');
    expect(reminders.delete).toHaveBeenCalledWith(AS_TEST_USER, 'abc');
  });

  it('DELETE /api/reminders/:id answers 409 for a reminder already sent', async () => {
    reminders.delete.mockRejectedValue(new DomainError('REMINDER_ALREADY_SENT'));

    const res = await request(app.getHttpServer()).delete('/api/reminders/abc').expect(409);

    expect(res.body).toEqual({ code: 'REMINDER_ALREADY_SENT', context: {} });
  });
});
