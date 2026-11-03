import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders as render } from '@/test/render';
import ReminderButton from './ReminderButton';

const env = vi.hoisted(() => ({
  createReminder: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, role: 'standard' }),
}));
vi.mock('../contexts/RemindersContext', () => ({
  useReminders: () => ({
    hasReminderForAuction: () => false,
    getReminderForAuction: () => undefined,
    createReminder: env.createReminder,
    deleteReminder: vi.fn(),
  }),
}));

beforeEach(() => {
  env.createReminder.mockReset().mockResolvedValue({ _id: 'r1' });
});

async function openDialog(auctionDate: string) {
  render(<ReminderButton auctionCode="C-1" auctionTitle="Casa" auctionDate={auctionDate} />);
  await userEvent.click(screen.getByTitle('Criar lembrete'));
}

// the picker's value lives in a hidden input inside its labelled group
const field = () => {
  const input = screen
    .getByRole('group', { name: /Data e hora do lembrete/ })
    .querySelector('input');
  if (!input) throw new Error('DateField input not found');
  return input;
};

// TS-11: the default reminder is one hour before the auction, on the Brasília clock.
describe('ReminderButton', () => {
  it('proposes one hour before the auction and sends it as a UTC instant', async () => {
    await openDialog('2026-03-10T15:00:00.000Z'); // 12:00 in Brasília

    expect(field()).toHaveValue('10/03/2026 11:00');

    await userEvent.click(screen.getByRole('button', { name: 'Criar Lembrete' }));

    expect(env.createReminder).toHaveBeenCalledWith(
      expect.objectContaining({ auctionId: 'C-1', scheduledAt: '2026-03-10T14:00:00.000Z' }),
    );
  });

  it('goes back across midnight: 00:30 in Brasília becomes 23:30 of the day before', async () => {
    await openDialog('2026-03-10T03:30:00.000Z'); // 00:30 on the 10th in Brasília

    expect(field()).toHaveValue('09/03/2026 23:30');

    await userEvent.click(screen.getByRole('button', { name: 'Criar Lembrete' }));

    expect(env.createReminder).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledAt: '2026-03-10T02:30:00.000Z' }),
    );
  });

  it('goes back across a month end onto 29 February', async () => {
    await openDialog('2028-03-01T03:30:00.000Z'); // 00:30 on 1 March 2028 in Brasília

    expect(field()).toHaveValue('29/02/2028 23:30');
  });
});
