import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { renderWithProviders as render } from '@/test/render';
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

describe('RemindersPage load failure', () => {
  it('shows an error alert, without the empty state, when the load failed', () => {
    env.reminders.loadFailed = true;
    render(<RemindersPage />);

    expect(screen.getByRole('alert')).toHaveTextContent(messages.loadFailed.reminders);
    expect(screen.queryByText('Nenhum lembrete agendado')).not.toBeInTheDocument();
  });

  it('retries the load from the alert', async () => {
    env.reminders.loadFailed = true;
    render(<RemindersPage />);

    await userEvent.click(screen.getByRole('button', { name: messages.patterns.errorState.retry }));

    expect(env.reminders.refreshReminders).toHaveBeenCalledTimes(1);
  });

  it('shows no alert when the load worked', () => {
    render(<RemindersPage />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Nenhum lembrete agendado')).toBeInTheDocument();
  });
});
