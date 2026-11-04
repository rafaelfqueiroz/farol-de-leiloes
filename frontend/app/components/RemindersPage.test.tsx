import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import RemindersPage from './RemindersPage';

// The reminders list says so when it could not be loaded, instead of looking empty.
const env = vi.hoisted(() => ({
  reminders: {
    reminders: [] as unknown[],
    loading: false,
    loadFailed: false,
    deleteReminder: vi.fn(),
    updateReminder: vi.fn(),
    refreshReminders: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../contexts/RemindersContext', () => ({ useReminders: () => env.reminders }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ role: 'standard' }) }));

beforeEach(() => {
  env.reminders = {
    reminders: [],
    loading: false,
    loadFailed: false,
    deleteReminder: vi.fn(),
    updateReminder: vi.fn(),
    refreshReminders: vi.fn().mockResolvedValue(undefined),
  };
});

const reminder = {
  _id: 'reminder-1',
  channel: 'EMAIL',
  scheduledAt: '2027-01-01T01:30:00Z',
  description: null,
  status: 'PENDING',
  createdAt: '2026-11-01T12:00:00Z',
  auction: {
    _id: 'auction-1',
    code: '123',
    title: 'Imóvel de teste',
    city: 'São Paulo',
    state: 'SP',
    detailsUrl: null,
  },
};

describe('RemindersPage dates (AR-23, DS-26)', () => {
  beforeEach(() => {
    env.reminders.reminders = [reminder];
    env.reminders.updateReminder.mockResolvedValue(true);
  });

  it('formats the list and edit picker in Brasília and saves an unchanged UTC instant', async () => {
    render(<RemindersPage />);
    expect(screen.getByText('31/12/2026 22:30')).toHaveAttribute(
      'datetime',
      '2027-01-01T01:30:00.000Z',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Editar lembrete' }));
    expect(screen.getByRole('spinbutton', { name: 'Day' })).toHaveTextContent('31');
    expect(screen.getByRole('spinbutton', { name: 'Hours' })).toHaveTextContent('22');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(env.reminders.updateReminder).toHaveBeenCalledWith('reminder-1', {
      channel: 'EMAIL',
      scheduledAt: '2027-01-01T01:30:00.000Z',
      description: undefined,
    });
  });

  it('keeps Brasília semantics after a keyboard calendar edit', async () => {
    render(<RemindersPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Editar lembrete' }));
    const day = screen.getByRole('spinbutton', { name: 'Day' });
    await userEvent.click(day);
    await userEvent.keyboard('30');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(env.reminders.updateReminder).toHaveBeenCalledWith(
      'reminder-1',
      expect.objectContaining({ scheduledAt: '2026-12-31T01:30:00.000Z' }),
    );
  });

  it.each(['light', 'dark'] as const)(
    'has an accessible edit form in %s (TS-19)',
    async (scheme) => {
      const { baseElement } = render(<RemindersPage />, { scheme });
      await userEvent.click(screen.getByRole('button', { name: 'Editar lembrete' }));
      expect(await axe(baseElement)).toHaveNoViolations();
    },
  );
});

describe('RemindersPage load failure', () => {
  it('shows the ErrorState, without the empty state, when the load failed', () => {
    env.reminders.loadFailed = true;
    render(<RemindersPage />);

    expect(screen.getByRole('alert')).toHaveTextContent(messages.loadFailed.reminders.title);
    expect(screen.getByRole('alert')).toHaveTextContent(messages.loadFailed.reminders.message);
    expect(screen.queryByText('Nenhum lembrete agendado')).not.toBeInTheDocument();
  });

  it('retries the load from the ErrorState', async () => {
    env.reminders.loadFailed = true;
    render(<RemindersPage />);

    await userEvent.click(screen.getByRole('button', { name: messages.patterns.errorState.retry }));

    expect(env.reminders.refreshReminders).toHaveBeenCalledTimes(1);
  });

  it('shows no ErrorState when the load worked', () => {
    render(<RemindersPage />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Nenhum lembrete agendado')).toBeInTheDocument();
  });
});
