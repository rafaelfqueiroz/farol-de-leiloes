import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoneLogged, spyOnLogger } from '../../test/support/logger-spy.js';
import { RemindersScheduler } from './reminders.scheduler.js';
import { ReminderChannel } from './schemas/reminder.schema.js';
import { PopulatedReminder } from './interfaces/reminder.interface.js';

type SchedulerDeps = ConstructorParameters<typeof RemindersScheduler>;

describe('RemindersScheduler.processReminder', () => {
  function build() {
    const remindersService = { logNotification: vi.fn(), markAsSent: vi.fn() };
    const usersService = {
      findByIdFull: vi.fn().mockResolvedValue({
        _id: 'user-1',
        name: 'Test User',
        email: 'user@example.test',
        phone: undefined,
      }),
    };
    const smsService = { sendReminderSms: vi.fn() };
    const whatsAppService = { sendReminderWhatsApp: vi.fn() };
    const scheduler = new RemindersScheduler(
      remindersService as unknown as SchedulerDeps[0],
      usersService as unknown as SchedulerDeps[1],
      {} as SchedulerDeps[2],
      smsService as unknown as SchedulerDeps[3],
      whatsAppService as unknown as SchedulerDeps[4],
      {} as SchedulerDeps[5],
      {} as SchedulerDeps[6],
    );
    return { scheduler, remindersService, usersService, smsService, whatsAppService };
  }

  it.each([ReminderChannel.SMS, ReminderChannel.WHATSAPP])(
    'skips a %s reminder whose user no longer has a phone, leaving it pending (DV-03)',
    async (channel) => {
      const { scheduler, remindersService, smsService, whatsAppService } = build();
      const reminder = {
        _id: 'reminder-1',
        userId: 'user-1',
        channel,
        auction: null,
      } as unknown as PopulatedReminder;

      await scheduler['processReminder'](reminder);

      expect(smsService.sendReminderSms).not.toHaveBeenCalled();
      expect(whatsAppService.sendReminderWhatsApp).not.toHaveBeenCalled();
      expect(remindersService.logNotification).not.toHaveBeenCalled();
      expect(remindersService.markAsSent).not.toHaveBeenCalled();
    },
  );

  afterEach(() => vi.restoreAllMocks());

  // SC-15: provider and SMTP errors quote the recipient, so neither the log nor the stored
  // notification record carries a message, only a stable code.
  it('records and logs a provider failure by code, never by its message', async () => {
    const logger = spyOnLogger();
    const { scheduler, remindersService, usersService, smsService } = build();
    usersService.findByIdFull.mockResolvedValue({
      _id: 'user-1',
      name: 'Fulana Ficticia',
      email: 'fulana.ficticia@example.test',
      phone: '+5500000000000',
    });
    smsService.sendReminderSms.mockResolvedValue({ success: false, errorMessage: '21211' });
    const reminder = {
      _id: 'reminder-1',
      userId: 'user-1',
      channel: ReminderChannel.SMS,
      auction: null,
    } as unknown as PopulatedReminder;

    await scheduler['processReminder'](reminder);

    expect(remindersService.logNotification.mock.calls[0]?.slice(4)).toEqual([false, '21211']);
    expect(logger.loggedText()).toContain('21211');
    expectNoneLogged(logger.loggedText(), ['+5500000000000', 'fulana.ficticia@example.test']);
  });

  it('logs an unexpected error by its class, not its message', async () => {
    const logger = spyOnLogger();
    const { scheduler, usersService } = build();
    usersService.findByIdFull.mockRejectedValue(new TypeError('fulana.ficticia@example.test'));

    await scheduler['processReminder']({
      _id: 'reminder-1',
      userId: 'user-1',
    } as unknown as PopulatedReminder);

    expect(logger.loggedText()).toContain('TypeError');
    expectNoneLogged(logger.loggedText(), ['fulana.ficticia@example.test']);
  });
});
