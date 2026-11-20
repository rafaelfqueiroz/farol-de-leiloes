import { afterEach, describe, expect, it, vi } from 'vitest';
import { spyOnLogger } from '../../test/support/logger-spy.js';
import { RemindersScheduler, REMINDERS_JOB } from './reminders.scheduler.js';
import { ReminderChannel } from './schemas/reminder.schema.js';
import type { PopulatedReminder } from './interfaces/reminder.interface.js';
import { RunMode } from '../common/job-execution.js';
import { currentLogContext } from '../common/observability/log-context.js';

type Deps = ConstructorParameters<typeof RemindersScheduler>;

const USER = {
  _id: 'user-1',
  name: 'Fulana Ficticia',
  email: 'fulana.ficticia@example.test',
  phone: '+5500000000000',
};

function aReminder(overrides: Record<string, unknown> = {}): PopulatedReminder {
  return {
    _id: 'reminder-1',
    userId: 'user-1',
    channel: ReminderChannel.EMAIL,
    description: 'Bid before noon',
    scheduledAt: new Date('2026-01-26T13:00:00.000Z'),
    auction: {
      title: 'Apartamento',
      code: 'A1',
      detailsUrl: 'https://example.test/a1',
      address: { city: 'Campinas', state: 'SP' },
    },
    ...overrides,
  } as unknown as PopulatedReminder;
}

function build(reminders = { enabled: true }) {
  const remindersService = {
    getDueReminders: vi.fn().mockResolvedValue([]),
    logNotification: vi.fn().mockResolvedValue(undefined),
    markAsSent: vi.fn().mockResolvedValue(undefined),
  };
  const usersService = { findByIdFull: vi.fn().mockResolvedValue(USER) };
  const emailService = { sendReminderEmail: vi.fn().mockResolvedValue(undefined) };
  const smsService = { sendReminderSms: vi.fn().mockResolvedValue({ success: true }) };
  const whatsAppService = { sendReminderWhatsApp: vi.fn().mockResolvedValue({ success: true }) };
  const jobExecutionService = { recordExecution: vi.fn().mockResolvedValue(undefined) };
  const scheduler = new RemindersScheduler(
    remindersService as unknown as Deps[0],
    usersService as unknown as Deps[1],
    emailService as unknown as Deps[2],
    smsService as unknown as Deps[3],
    whatsAppService as unknown as Deps[4],
    jobExecutionService as unknown as Deps[5],
    { reminders } as unknown as Deps[6],
  );
  return {
    scheduler,
    remindersService,
    usersService,
    emailService,
    smsService,
    whatsAppService,
    jobExecutionService,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('RemindersScheduler.onModuleInit', () => {
  it('announces the 15-minute schedule when enabled', async () => {
    const logger = spyOnLogger();
    await build({ enabled: true }).scheduler.onModuleInit();
    expect(logger.loggedText()).toContain('Running every 15 minutes');
  });

  it('says it is disabled when REMINDERS_ENABLED is false', async () => {
    const logger = spyOnLogger();
    await build({ enabled: false }).scheduler.onModuleInit();
    expect(logger.loggedText()).toContain('disabled');
    expect(logger.loggedText()).not.toContain('Running every 15 minutes');
  });
});

describe('RemindersScheduler.processReminders', () => {
  it('does nothing when the job is disabled', async () => {
    const { scheduler, remindersService, jobExecutionService } = build({ enabled: false });

    await scheduler.processReminders();

    expect(remindersService.getDueReminders).not.toHaveBeenCalled();
    expect(jobExecutionService.recordExecution).not.toHaveBeenCalled();
  });

  it('asks for at most 50 due reminders and records no run when none are due', async () => {
    const { scheduler, remindersService, jobExecutionService } = build();

    await scheduler.processReminders();

    expect(remindersService.getDueReminders).toHaveBeenCalledWith(50);
    expect(jobExecutionService.recordExecution).not.toHaveBeenCalled();
  });

  it('runs inside a job log context named after the job (AR-46)', async () => {
    const { scheduler, remindersService } = build();
    let seen: string | undefined;
    remindersService.getDueReminders.mockImplementation(() => {
      seen = currentLogContext()?.jobName;
      return Promise.resolve([]);
    });

    await scheduler.processReminders();

    expect(seen).toBe(REMINDERS_JOB);
  });

  it('processes every due reminder, then records one automatic run', async () => {
    const { scheduler, remindersService, jobExecutionService, emailService } = build();
    remindersService.getDueReminders.mockResolvedValue([
      aReminder({ _id: 'r1' }),
      aReminder({ _id: 'r2' }),
    ]);

    await scheduler.processReminders();

    expect(emailService.sendReminderEmail).toHaveBeenCalledTimes(2);
    expect(remindersService.markAsSent.mock.calls).toEqual([['r1'], ['r2']]);
    expect(jobExecutionService.recordExecution).toHaveBeenCalledTimes(1);
    expect(jobExecutionService.recordExecution).toHaveBeenCalledWith(REMINDERS_JOB, RunMode.AUTO);
  });

  it.each(['closed', 'deactivated'])(
    'BR-010-14: nothing is sent to a %s account, whatever the channel, and the reminder stays pending',
    async (status) => {
      const {
        scheduler,
        remindersService,
        usersService,
        emailService,
        smsService,
        whatsAppService,
      } = build();
      usersService.findByIdFull.mockResolvedValue({ ...USER, status });
      remindersService.getDueReminders.mockResolvedValue([
        aReminder({ _id: 'r1', channel: ReminderChannel.EMAIL }),
        aReminder({ _id: 'r2', channel: ReminderChannel.SMS }),
        aReminder({ _id: 'r3', channel: ReminderChannel.WHATSAPP }),
      ]);

      await scheduler.processReminders();

      expect(emailService.sendReminderEmail).not.toHaveBeenCalled();
      expect(smsService.sendReminderSms).not.toHaveBeenCalled();
      expect(whatsAppService.sendReminderWhatsApp).not.toHaveBeenCalled();
      expect(remindersService.logNotification).not.toHaveBeenCalled();
      expect(remindersService.markAsSent).not.toHaveBeenCalled();
    },
  );

  it('BR-010-14: an account with no status stored is active (AR-28) and is still notified', async () => {
    const { scheduler, remindersService, emailService } = build();
    remindersService.getDueReminders.mockResolvedValue([aReminder()]);

    await scheduler.processReminders();

    expect(emailService.sendReminderEmail).toHaveBeenCalledTimes(1);
  });

  it('logs a failure to load the due reminders by code and does not record a run', async () => {
    const logger = spyOnLogger();
    const { scheduler, remindersService, jobExecutionService } = build();
    remindersService.getDueReminders.mockRejectedValue(new TypeError('boom fulana'));

    await expect(scheduler.processReminders()).resolves.toBeUndefined();

    expect(logger.loggedText()).toContain('Failed to process reminders: TypeError');
    expect(logger.loggedText()).not.toContain('fulana');
    expect(jobExecutionService.recordExecution).not.toHaveBeenCalled();
  });
});

describe('RemindersScheduler per-channel delivery', () => {
  it('sends an e-mail reminder with the auction details and marks it sent', async () => {
    const { scheduler, remindersService, emailService } = build();

    await scheduler['processReminder'](aReminder());

    expect(emailService.sendReminderEmail).toHaveBeenCalledWith('fulana.ficticia@example.test', {
      userName: 'Fulana Ficticia',
      auctionTitle: 'Apartamento',
      auctionCode: 'A1',
      auctionCity: 'Campinas',
      auctionState: 'SP',
      auctionDetailsUrl: 'https://example.test/a1',
      description: 'Bid before noon',
      scheduledAt: new Date('2026-01-26T13:00:00.000Z'),
    });
    expect(remindersService.logNotification).toHaveBeenCalledWith(
      'reminder-1',
      'user-1',
      ReminderChannel.EMAIL,
      'fulana.ficticia@example.test',
      true,
      undefined,
    );
    expect(remindersService.markAsSent).toHaveBeenCalledWith('reminder-1');
  });

  it('falls back to nulls and an empty code when the auction is gone', async () => {
    const { scheduler, emailService } = build();

    await scheduler['processReminder'](aReminder({ auction: null, description: undefined }));

    expect(emailService.sendReminderEmail).toHaveBeenCalledWith('fulana.ficticia@example.test', {
      userName: 'Fulana Ficticia',
      auctionTitle: null,
      auctionCode: '',
      auctionCity: null,
      auctionState: null,
      auctionDetailsUrl: null,
      description: null,
      scheduledAt: new Date('2026-01-26T13:00:00.000Z'),
    });
  });

  it('records a failed e-mail by its code, leaves the reminder pending and logs the failure', async () => {
    const logger = spyOnLogger();
    const { scheduler, remindersService, emailService } = build();
    emailService.sendReminderEmail.mockRejectedValue(new TypeError('smtp rejected fulana'));

    await scheduler['processReminder'](aReminder());

    expect(remindersService.logNotification.mock.calls[0]?.slice(4)).toEqual([false, 'TypeError']);
    expect(remindersService.markAsSent).not.toHaveBeenCalled();
    expect(logger.loggedText()).toContain('reminder-1 failed');
  });

  it('sends an SMS with the auction title, or its code when it has no title', async () => {
    const { scheduler, smsService, remindersService } = build();

    await scheduler['processReminder'](aReminder({ channel: ReminderChannel.SMS }));
    await scheduler['processReminder'](
      aReminder({
        channel: ReminderChannel.SMS,
        description: undefined,
        auction: { code: 'B2', address: {} },
      }),
    );

    expect(smsService.sendReminderSms.mock.calls).toEqual([
      [
        '+5500000000000',
        {
          auctionTitle: 'Apartamento',
          auctionCode: 'A1',
          auctionCity: 'Campinas',
          auctionState: 'SP',
          description: 'Bid before noon',
        },
      ],
      [
        '+5500000000000',
        {
          auctionTitle: 'B2',
          auctionCode: 'B2',
          auctionCity: null,
          auctionState: null,
          description: null,
        },
      ],
    ]);
    expect(remindersService.markAsSent).toHaveBeenCalledTimes(2);
  });

  it('sends a WhatsApp message with the user name and the details link', async () => {
    const { scheduler, whatsAppService, remindersService } = build();

    await scheduler['processReminder'](aReminder({ channel: ReminderChannel.WHATSAPP }));

    expect(whatsAppService.sendReminderWhatsApp).toHaveBeenCalledWith('+5500000000000', {
      userName: 'Fulana Ficticia',
      auctionTitle: 'Apartamento',
      auctionCode: 'A1',
      auctionCity: 'Campinas',
      auctionState: 'SP',
      auctionDetailsUrl: 'https://example.test/a1',
      description: 'Bid before noon',
    });
    expect(remindersService.markAsSent).toHaveBeenCalledWith('reminder-1');
  });

  it('uses nulls for a WhatsApp reminder whose auction is gone', async () => {
    const { scheduler, whatsAppService } = build();

    await scheduler['processReminder'](
      aReminder({ channel: ReminderChannel.WHATSAPP, auction: null, description: undefined }),
    );

    expect(whatsAppService.sendReminderWhatsApp).toHaveBeenCalledWith('+5500000000000', {
      userName: 'Fulana Ficticia',
      auctionTitle: '',
      auctionCode: '',
      auctionCity: null,
      auctionState: null,
      auctionDetailsUrl: null,
      description: null,
    });
  });

  it('skips a reminder whose user no longer exists, leaving it pending', async () => {
    const logger = spyOnLogger();
    const { scheduler, usersService, remindersService, emailService } = build();
    usersService.findByIdFull.mockResolvedValue(null);

    await scheduler['processReminder'](aReminder());

    expect(logger.loggedText()).toContain('User not found for reminder reminder-1');
    expect(emailService.sendReminderEmail).not.toHaveBeenCalled();
    expect(remindersService.markAsSent).not.toHaveBeenCalled();
  });

  it('refuses a channel it does not know without sending or marking anything', async () => {
    const logger = spyOnLogger();
    const { scheduler, remindersService, emailService, smsService, whatsAppService } = build();

    await scheduler['processReminder'](aReminder({ channel: 'PIGEON' }));

    expect(logger.loggedText()).toContain('Unknown channel: PIGEON');
    expect(emailService.sendReminderEmail).not.toHaveBeenCalled();
    expect(smsService.sendReminderSms).not.toHaveBeenCalled();
    expect(whatsAppService.sendReminderWhatsApp).not.toHaveBeenCalled();
    expect(remindersService.logNotification).not.toHaveBeenCalled();
  });
});
