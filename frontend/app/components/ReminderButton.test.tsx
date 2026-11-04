import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders as render } from '@/test/render';
import ReminderButton from '@/app/components/ReminderButton';

// Feature contexts and navigation have no injectable ports; keep the real picker/theme (TS-19).
const env = vi.hoisted(() => ({
  createReminder: vi.fn(),
  reminder: undefined as { scheduledAt: string; channel: string } | undefined,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ role: 'standard', isAuthenticated: true }),
}));
vi.mock('../contexts/RemindersContext', () => ({
  useReminders: () => ({
    hasReminderForAuction: () => !!env.reminder,
    getReminderForAuction: () => env.reminder,
    createReminder: env.createReminder,
    deleteReminder: vi.fn(),
  }),
}));

beforeEach(() => {
  env.reminder = undefined;
  env.createReminder.mockReset().mockResolvedValue({});
});

async function openReminder() {
  await userEvent.click(screen.getByRole('button', { name: 'Criar lembrete' }));
}

describe('ReminderButton dates (AR-23, DS-26)', () => {
  it('defaults to one hour before the auction across the Brasília year boundary', async () => {
    render(
      <ReminderButton
        auctionCode="123"
        auctionTitle="Imóvel de teste"
        auctionDate="2027-01-01T01:30:00Z"
      />,
    );
    await openReminder();
    expect(screen.getByRole('spinbutton', { name: 'Day' })).toHaveTextContent('31');
    expect(screen.getByRole('spinbutton', { name: 'Hours' })).toHaveTextContent('21');
    await userEvent.click(screen.getByRole('button', { name: 'Criar Lembrete' }));
    expect(env.createReminder).toHaveBeenCalledWith({
      auctionId: '123',
      channel: 'EMAIL',
      scheduledAt: '2027-01-01T00:30:00.000Z',
      description: undefined,
    });
  });

  it('saves a typed hour as a Brasília instant', async () => {
    render(
      <ReminderButton
        auctionCode="123"
        auctionTitle="Imóvel de teste"
        auctionDate="2027-01-01T01:30:00Z"
      />,
    );
    await openReminder();
    const hour = screen.getByRole('spinbutton', { name: 'Hours' });
    await userEvent.click(hour);
    await userEvent.keyboard('20');
    expect(hour).toHaveTextContent('20');
    await userEvent.click(screen.getByRole('button', { name: 'Criar Lembrete' }));
    expect(env.createReminder).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledAt: '2026-12-31T23:30:00.000Z' }),
    );
  });

  it('formats an existing reminder with DateText in Brasília', async () => {
    env.reminder = { scheduledAt: '2027-01-01T01:30:00Z', channel: 'EMAIL' };
    render(<ReminderButton auctionCode="123" auctionTitle="Imóvel de teste" />);
    await userEvent.click(screen.getByRole('button', { name: 'Gerenciar lembrete' }));
    expect(screen.getByText('31/12/2026 22:30')).toHaveAttribute(
      'datetime',
      '2027-01-01T01:30:00.000Z',
    );
  });

  it.each(['light', 'dark'] as const)(
    'has an accessible open picker form in %s (TS-19)',
    async (scheme) => {
      const { baseElement } = render(
        <ReminderButton auctionCode="123" auctionTitle="Imóvel de teste" />,
        { scheme },
      );
      await openReminder();
      expect(await axe(baseElement)).toHaveNoViolations();
    },
  );
});
