import { RemindersScheduler } from '../src/reminders/reminders.scheduler';
import { ReminderChannel } from '../src/reminders/schemas/reminder.schema';
import { PopulatedReminder } from '../src/reminders/interfaces/reminder.interface';

type SchedulerDeps = ConstructorParameters<typeof RemindersScheduler>;

describe('RemindersScheduler.processReminder', () => {
  function build() {
    const remindersService = { logNotification: jest.fn(), markAsSent: jest.fn() };
    const usersService = {
      findByIdFull: jest.fn().mockResolvedValue({
        _id: 'user-1',
        name: 'Test User',
        email: 'user@example.test',
        phone: undefined,
      }),
    };
    const smsService = { sendReminderSms: jest.fn() };
    const whatsAppService = { sendReminderWhatsApp: jest.fn() };
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
