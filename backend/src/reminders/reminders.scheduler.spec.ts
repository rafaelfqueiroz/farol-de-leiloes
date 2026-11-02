import { describe, expect, it, vi } from 'vitest';
import { RemindersScheduler } from './reminders.scheduler';
import { ReminderChannel } from './schemas/reminder.schema';
import { PopulatedReminder } from './interfaces/reminder.interface';

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
    return { scheduler, remindersService, smsService, whatsAppService };
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
});
