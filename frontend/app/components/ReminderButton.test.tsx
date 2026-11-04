import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders as render } from '@/test/render';
import ReminderButton from '@/app/components/ReminderButton';

// Feature contexts and navigation have no injectable ports; keep the real picker/theme (TS-19).
const env = vi.hoisted(() => ({
  createReminder: vi.fn(),
  deleteReminder: vi.fn(),
  reminder: undefined as { _id: string; scheduledAt: string; channel: string } | undefined,
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
    deleteReminder: env.deleteReminder,
  }),
}));

beforeEach(() => {
  env.reminder = undefined;
  env.createReminder.mockReset().mockResolvedValue({});
  env.deleteReminder.mockReset().mockResolvedValue(true);
});

async function openReminder() {
  await userEvent.click(await screen.findByRole('button', { name: 'Criar lembrete' }));
}

describe('ReminderButton dates (AR-23, DS-26)', () => {
  // Preserve #34's ordinary, midnight and leap-year default regressions after the merge.
  it.each([
    ['2026-03-10T15:00:00Z', '10/03/2026 11:00', '2026-03-10T14:00:00.000Z'],
    ['2026-03-10T03:30:00Z', '09/03/2026 23:30', '2026-03-10T02:30:00.000Z'],
    ['2028-03-01T03:30:00Z', '29/02/2028 23:30', '2028-03-01T02:30:00.000Z'],
  ])('defaults one hour before %s', async (auctionDate, display, instant) => {
    render(
      <ReminderButton auctionCode="123" auctionTitle="Imóvel de teste" auctionDate={auctionDate} />,
    );
    await openReminder();
    expect(
      screen.getByRole('group', { name: /Data e hora do lembrete/ }).querySelector('input'),
    ).toHaveValue(display);
    await userEvent.click(screen.getByRole('button', { name: 'Criar Lembrete' }));
    expect(env.createReminder).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledAt: instant }),
    );
  });

  it('discards cancelled drafts and recalculates from a changed auction date', async () => {
    const { rerender } = render(
      <ReminderButton
        auctionCode="123"
        auctionTitle="Imóvel de teste"
        auctionDate="2027-01-01T01:30:00Z"
      />,
    );
    await openReminder();
    await userEvent.click(screen.getByRole('spinbutton', { name: 'Horas' }));
    await userEvent.keyboard('20');
    await userEvent.type(screen.getByRole('textbox', { name: 'Nota (opcional)' }), 'Rascunho');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await openReminder();
    expect(screen.getByRole('spinbutton', { name: 'Horas' })).toHaveTextContent('21');
    expect(screen.getByRole('textbox', { name: 'Nota (opcional)' })).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    rerender(
      <ReminderButton
        auctionCode="123"
        auctionTitle="Imóvel de teste"
        auctionDate="2027-01-02T03:30:00Z"
      />,
    );
    await openReminder();
    expect(screen.getByRole('spinbutton', { name: 'Dia' })).toHaveTextContent('01');
    expect(screen.getByRole('spinbutton', { name: 'Horas' })).toHaveTextContent('23');
  });

  it('starts a fresh default after creating and deleting a reminder', async () => {
    const props = {
      auctionCode: '123',
      auctionTitle: 'Imóvel de teste',
      auctionDate: '2027-01-01T01:30:00Z',
    };
    const { rerender } = render(<ReminderButton {...props} />);
    await openReminder();
    await userEvent.click(screen.getByRole('spinbutton', { name: 'Horas' }));
    await userEvent.keyboard('20');
    await userEvent.click(screen.getByRole('button', { name: 'Criar Lembrete' }));
    env.reminder = { _id: 'r1', scheduledAt: '2026-12-31T23:30:00Z', channel: 'EMAIL' };
    rerender(<ReminderButton {...props} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Gerenciar lembrete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remover Lembrete' }));
    env.reminder = undefined;
    rerender(<ReminderButton {...props} />);
    await openReminder();
    expect(screen.getByRole('spinbutton', { name: 'Horas' })).toHaveTextContent('21');
  });

  it.each(['2027-01-01', '2027-01-01T01:30:00', 'invalid'])(
    'leaves an invalid or date-only auction timestamp editable: %s',
    async (auctionDate) => {
      render(
        <ReminderButton
          auctionCode="123"
          auctionTitle="Imóvel de teste"
          auctionDate={auctionDate}
        />,
      );
      await openReminder();
      await userEvent.click(screen.getByRole('button', { name: 'Criar Lembrete' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Selecione a data e hora do lembrete');
      expect(env.createReminder).not.toHaveBeenCalled();
    },
  );

  it('defaults to one hour before the auction across the Brasília year boundary', async () => {
    render(
      <ReminderButton
        auctionCode="123"
        auctionTitle="Imóvel de teste"
        auctionDate="2027-01-01T01:30:00Z"
      />,
    );
    await openReminder();
    expect(screen.getByRole('spinbutton', { name: 'Dia' })).toHaveTextContent('31');
    expect(screen.getByRole('spinbutton', { name: 'Horas' })).toHaveTextContent('21');
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
    const hour = screen.getByRole('spinbutton', { name: 'Horas' });
    await userEvent.click(hour);
    await userEvent.keyboard('20');
    expect(hour).toHaveTextContent('20');
    await userEvent.click(screen.getByRole('button', { name: 'Criar Lembrete' }));
    expect(env.createReminder).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledAt: '2026-12-31T23:30:00.000Z' }),
    );
  });

  it('formats an existing reminder with DateText in Brasília', async () => {
    env.reminder = { _id: 'r1', scheduledAt: '2027-01-01T01:30:00Z', channel: 'EMAIL' };
    render(<ReminderButton auctionCode="123" auctionTitle="Imóvel de teste" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Gerenciar lembrete' }));
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
