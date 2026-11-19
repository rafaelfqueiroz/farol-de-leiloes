import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-error';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import ChangePlanDialog from './ChangePlanDialog';
import { CATALOGUE, OFFICE_ID, aSubscription, routedApi, type Handler } from './plans-test-support';

// SPEC-012 frames 13 and 14: the dialog asks the backend what a change would do before it is made.
const env = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiJson: (...args: unknown[]) => env.api(...args) }));

const t = messages.plans.change;
const onChanged = vi.fn();
const onClose = vi.fn();

const UPGRADE_PREVIEW = {
  change: 'upgrade',
  amountDue: '12600.09',
  currency: 'BRL',
  lines: [{ amount: '12990.00' }, { amount: '-389.91' }],
  effectiveAt: null,
  nextChargeAt: '2027-11-18T15:00:00.000Z',
  nextChargeAmount: '12990.00',
  quote: {
    planCode: 'avancado',
    prorationDate: '2026-11-18T15:00:00.000Z',
    amountDue: '12600.09',
    currency: 'BRL',
    nextChargeDate: '2027-11-18T15:00:00.000Z',
    expiresAt: '2026-11-18T15:02:00.000Z',
  },
};
const DOWNGRADE_PREVIEW = {
  change: 'schedule',
  amountDue: '0.00',
  currency: 'BRL',
  lines: [],
  effectiveAt: '2026-12-14T15:00:00.000Z',
  nextChargeAt: '2026-12-14T15:00:00.000Z',
  nextChargeAmount: '189.90',
};

function serve(routes: Record<string, Handler>) {
  env.api = routedApi(routes);
}

function open(
  props: Partial<React.ComponentProps<typeof ChangePlanDialog>> = {},
  scheme: 'light' | 'dark' = 'light',
) {
  return render(
    <ChangePlanDialog
      open
      onClose={onClose}
      plans={CATALOGUE.items}
      subscription={aSubscription()}
      onChanged={onChanged}
      {...props}
    />,
    { scheme },
  );
}

beforeEach(() => {
  onChanged.mockReset();
  onClose.mockReset();
});
afterEach(() => env.api.mockReset());

describe('ChangePlanDialog', () => {
  it.each(['light', 'dark'] as const)(
    'frame 13: an upgrade shows the provider amount, the credit and the next charge, and nothing until a plan is chosen (%s)',
    async (scheme) => {
      const user = userEvent.setup();
      serve({
        'POST /api/office/subscription/change-preview': () => UPGRADE_PREVIEW,
        'POST /api/office/subscription/change': () => aSubscription(),
      });
      open({}, scheme);
      const dialog = screen.getByRole('dialog', { name: t.title });
      expect(within(dialog).getByRole('radiogroup')).toBeInTheDocument();
      expect(
        within(dialog).getByText('Plano atual: Profissional · 5 jornadas simultâneas.'),
      ).toBeVisible();
      // the plan in effect is shown, marked and disabled; confirming needs another choice
      expect(within(dialog).getByRole('radio', { name: 'Profissional' })).toBeDisabled();
      expect(within(dialog).getByRole('button', { name: t.confirm })).toBeDisabled();

      await user.click(within(dialog).getByRole('radio', { name: 'Avançado' }));

      const radio = within(dialog).getByRole('radio', { name: 'Avançado' });
      await waitFor(() =>
        expect(radio).toHaveAccessibleDescription(/Cobramos agora R\$\s12\.600,09/),
      );
      const description = radio.getAttribute('aria-describedby') ?? '';
      const text = (document.getElementById(description)?.textContent ?? '').replace(
        /\u00a0/g,
        ' ',
      );
      expect(text).toContain('R$ 12.990,00 do novo plano menos R$ 389,91 de crédito');
      expect(text).toContain('Próxima cobrança em 18/11/2027.');
      expect(text).toContain('Valor calculado pela Stripe antes do pagamento.');
      expect(env.api).toHaveBeenCalledWith('/api/office/subscription/change-preview', {
        method: 'POST',
        json: { planCode: 'avancado', officeId: OFFICE_ID },
      });
      expect(within(dialog).getByRole('button', { name: t.confirm })).toBeEnabled();
      expect(await axe(dialog)).toHaveNoViolations();
    },
  );

  it('frame 14: a downgrade below the journeys in progress says when it starts and that nothing is closed, and is still allowed', async () => {
    const user = userEvent.setup();
    serve({
      'POST /api/office/subscription/change-preview': () => DOWNGRADE_PREVIEW,
      'POST /api/office/subscription/change': () => aSubscription(),
    });
    open();

    await user.click(screen.getByRole('radio', { name: 'Essencial' }));

    expect(await screen.findByText(/Vale a partir do próximo período/)).toHaveTextContent(
      'Vale a partir do próximo período (14/12/2026). Até lá, o plano atual continua.',
    );
    expect(
      screen.getByText(
        'Seu escritório tem 4 jornadas em andamento. Elas continuam normalmente, mas novas jornadas só poderão ser iniciadas quando houver menos de 2 em andamento.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: t.confirm })).toBeEnabled();
  });

  it('confirming sends the change for the chosen plan and tells the page what it was', async () => {
    const user = userEvent.setup();
    const answer = aSubscription({ activeJourneyLimit: 5 });
    serve({
      'POST /api/office/subscription/change-preview': () => UPGRADE_PREVIEW,
      'POST /api/office/subscription/change': () => answer,
    });
    open();

    await user.click(screen.getByRole('radio', { name: 'Avançado' }));
    await waitFor(() => expect(screen.getByRole('button', { name: t.confirm })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: t.confirm }));

    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith({
        subscription: answer,
        change: 'upgrade',
        targetCode: 'avancado',
        targetName: 'Avançado',
        targetLimit: 15,
      }),
    );
    expect(env.api).toHaveBeenCalledWith('/api/office/subscription/change', {
      method: 'POST',
      json: {
        planCode: 'avancado',
        officeId: OFFICE_ID,
        quote: expect.objectContaining({ prorationDate: '2026-11-18T15:00:00.000Z' }),
      },
    });
  });

  it('opens with the plan the caller came for already chosen', async () => {
    serve({ 'POST /api/office/subscription/change-preview': () => DOWNGRADE_PREVIEW });
    open({ initialPlanCode: 'essencial' });

    expect(await screen.findByRole('radio', { name: 'Essencial' })).toBeChecked();
    await screen.findByText(/Vale a partir do próximo período/);
  });

  it('shows the message of the code when the preview cannot be computed, and keeps confirm off', async () => {
    const user = userEvent.setup();
    serve({
      'POST /api/office/subscription/change-preview': () => {
        throw new ApiError('CHANGE_PREVIEW_FAILED', {}, 502);
      },
    });
    open();

    await user.click(screen.getByRole('radio', { name: 'Avançado' }));

    expect(await screen.findByText(messages.errors.CHANGE_PREVIEW_FAILED)).toBeVisible();
    expect(screen.getByRole('button', { name: t.confirm })).toBeDisabled();
  });

  it('a refused change stays in the dialog as an alert and the plan is not reported changed', async () => {
    const user = userEvent.setup();
    serve({
      'POST /api/office/subscription/change-preview': () => UPGRADE_PREVIEW,
      'POST /api/office/subscription/change': () => {
        throw new ApiError('CHANGE_PLAN_FAILED', {}, 502);
      },
    });
    open();

    await user.click(screen.getByRole('radio', { name: 'Avançado' }));
    await waitFor(() => expect(screen.getByRole('button', { name: t.confirm })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: t.confirm }));

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.CHANGE_PLAN_FAILED);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('an upgrade with no charge now says the credit covers it; one with no credit lines says the amount alone', async () => {
    const user = userEvent.setup();
    serve({
      'POST /api/office/subscription/change-preview': () => ({
        ...UPGRADE_PREVIEW,
        amountDue: '0.00',
        lines: [{ amount: '100.00' }, { amount: '-100.00' }],
      }),
    });
    const { unmount } = open();
    await user.click(screen.getByRole('radio', { name: 'Avançado' }));
    expect(await screen.findByText(/Não há cobrança agora/)).toBeVisible();
    unmount();

    serve({
      'POST /api/office/subscription/change-preview': () => ({
        ...UPGRADE_PREVIEW,
        amountDue: '50.00',
        lines: [{ amount: '50.00' }],
        nextChargeAt: null,
      }),
    });
    open();
    await user.click(screen.getByRole('radio', { name: 'Avançado' }));
    expect(await screen.findByText(/Cobramos agora/)).toHaveTextContent(
      'Cobramos agora R$ 50,00. Valor calculado pela Stripe antes do pagamento.',
    );
  });

  it('choosing the plan already scheduled changes nothing; Voltar closes', async () => {
    const user = userEvent.setup();
    serve({
      'POST /api/office/subscription/change-preview': () => ({
        ...DOWNGRADE_PREVIEW,
        change: 'keep',
      }),
    });
    open();

    await user.click(screen.getByRole('radio', { name: 'Essencial' }));

    expect(await screen.findByText(t.effectKeep)).toBeVisible();
    expect(screen.getByRole('button', { name: t.confirm })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: t.back }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ChangePlanDialog quotes (owner review #173, BR-012-16)', () => {
  const QUOTE = UPGRADE_PREVIEW.quote;

  it('confirming an upgrade sends back the quote it was shown: the pinned date, the amount, the next charge', async () => {
    const user = userEvent.setup();
    serve({
      'POST /api/office/subscription/change-preview': () => UPGRADE_PREVIEW,
      'POST /api/office/subscription/change': () => aSubscription(),
    });
    open();

    await user.click(screen.getByRole('radio', { name: 'Avançado' }));
    await waitFor(() => expect(screen.getByRole('button', { name: t.confirm })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: t.confirm }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(env.api).toHaveBeenCalledWith('/api/office/subscription/change', {
      method: 'POST',
      json: {
        planCode: 'avancado',
        officeId: OFFICE_ID,
        quote: {
          planCode: 'avancado',
          prorationDate: QUOTE.prorationDate,
          amountDue: '12600.09',
          nextChargeDate: QUOTE.nextChargeDate,
        },
      },
    });
  });

  it('a downgrade, which has no quote, sends none', async () => {
    const user = userEvent.setup();
    serve({
      'POST /api/office/subscription/change-preview': () => ({ ...DOWNGRADE_PREVIEW, quote: null }),
      'POST /api/office/subscription/change': () => aSubscription(),
    });
    open();

    await user.click(screen.getByRole('radio', { name: 'Essencial' }));
    await waitFor(() => expect(screen.getByRole('button', { name: t.confirm })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: t.confirm }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [, init] = env.api.mock.calls.find(
      ([path]) => path === '/api/office/subscription/change',
    ) as [string, { json: Record<string, unknown> }];
    expect(init.json).not.toHaveProperty('quote');
  });

  it('QUOTE_STALE: nothing is reported changed, the amount is asked for again and the member confirms the new one', async () => {
    const user = userEvent.setup();
    let previews = 0;
    let changes = 0;
    serve({
      'POST /api/office/subscription/change-preview': () => {
        previews += 1;
        return previews === 1
          ? UPGRADE_PREVIEW
          : {
              ...UPGRADE_PREVIEW,
              amountDue: '349.90',
              lines: [{ amount: '349.90' }],
              quote: {
                ...QUOTE,
                amountDue: '349.90',
                prorationDate: '2026-11-18T15:05:00.000Z',
                expiresAt: '2026-11-18T15:07:00.000Z',
              },
            };
      },
      'POST /api/office/subscription/change': () => {
        changes += 1;
        if (changes === 1) throw new ApiError('QUOTE_STALE', {}, 409);
        return aSubscription();
      },
    });
    open();
    await user.click(screen.getByRole('radio', { name: 'Avançado' }));
    await waitFor(() => expect(screen.getByRole('button', { name: t.confirm })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: t.confirm }));

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.QUOTE_STALE);
    expect(onChanged).not.toHaveBeenCalled();
    // the new amount is shown, and only the member's next click confirms it
    await waitFor(() => expect(previews).toBe(2));
    await waitFor(() => expect(screen.getByRole('button', { name: t.confirm })).toBeEnabled());
    expect(
      document.getElementById(
        screen.getByRole('radio', { name: 'Avançado' }).getAttribute('aria-describedby') ?? '',
      ),
    ).toHaveTextContent(/Cobramos agora R\$\s349,90/);
    expect(changes).toBe(1);
    await user.click(screen.getByRole('button', { name: t.confirm }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(env.api).toHaveBeenLastCalledWith(
      '/api/office/subscription/change',
      expect.objectContaining({
        json: expect.objectContaining({
          quote: expect.objectContaining({ amountDue: '349.90' }),
        }),
      }),
    );
  });

  it('a quote that runs out is not left on screen: the amount is asked for again, confirm is off meanwhile, and the member is told', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let previews = 0;
    serve({
      'POST /api/office/subscription/change-preview': () => {
        previews += 1;
        return UPGRADE_PREVIEW;
      },
    });
    open();
    await user.click(screen.getByRole('radio', { name: 'Avançado' }));
    await waitFor(() => expect(screen.getByRole('button', { name: t.confirm })).toBeEnabled());
    expect(previews).toBe(1);

    // two minutes (the quote's lifetime) pass
    await act(() => vi.advanceTimersByTimeAsync(2 * 60 * 1000));

    await waitFor(() => expect(previews).toBe(2));
    expect(await screen.findByText(t.quoteExpired)).toBeVisible();
    // and a re-read quote is good for its own two minutes
    await waitFor(() => expect(screen.getByRole('button', { name: t.confirm })).toBeEnabled());
    vi.useRealTimers();
  });
});
