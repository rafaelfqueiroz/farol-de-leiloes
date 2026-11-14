// HTTP contract of GET /api/reminders (TESTING §2): pagination (AR-35) and the response DTO with
// its nested auction (AR-36), with RemindersService stubbed and the signed-in user faked.
import { afterAll, beforeAll, describe, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import { RemindersController } from './reminders.controller.js';
import { RemindersService } from './reminders.service.js';
import { ReminderChannel, ReminderStatus } from './schemas/reminder.schema.js';
import { createHttpApp } from '../../test/support/http-app.js';
import { itAnswersPages } from '../../test/support/pagination-contract.js';

const REMINDER_ID = new Types.ObjectId('64b7f00000000000000000bb');
const AUCTION_ID = new Types.ObjectId('64b7f00000000000000000cc');

// The populated reminder as the service returns it, with a field the response must not carry.
const REMINDER = {
  _id: REMINDER_ID,
  userId: new Types.ObjectId('64b7f0000000000000000001'),
  channel: ReminderChannel.EMAIL,
  scheduledAt: new Date('2026-02-01T09:00:00.000Z'),
  description: undefined,
  status: ReminderStatus.PENDING,
  createdAt: new Date('2026-01-15T12:00:00.000Z'),
  auction: {
    _id: AUCTION_ID,
    code: '1444400000001',
    title: 'Casa',
    address: { city: 'Natal', state: 'RN', street: 'Rua A' },
    detailsUrl: null,
    updatedAt: new Date('2026-01-15T12:00:00.000Z'),
  },
};

describe('RemindersController over HTTP', () => {
  const reminders = { findPageByUser: vi.fn() };
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

  describe('GET /api/reminders', () => {
    itAnswersPages({
      app: () => app,
      path: '/api/reminders',
      method: reminders.findPageByUser,
      pageArg: 1,
      item: REMINDER,
      expectedItem: {
        _id: REMINDER_ID.toString(),
        channel: 'EMAIL',
        scheduledAt: '2026-02-01T09:00:00.000Z',
        description: null,
        status: 'PENDING',
        createdAt: '2026-01-15T12:00:00.000Z',
        auction: {
          _id: AUCTION_ID.toString(),
          code: '1444400000001',
          title: 'Casa',
          city: 'Natal',
          state: 'RN',
          detailsUrl: null,
        },
      },
    });
  });
});
