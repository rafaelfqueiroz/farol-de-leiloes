import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-error';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import OfficePlanPage, { UPGRADE_MAX_WAIT_MS, UPGRADE_POLL_INTERVAL_MS } from './OfficePlanPage';
import { CATALOGUE, OFFICE_ID, aSubscription, routedApi, type Handler } from './plans-test-support';
import type { Invoice, InvoicesPage, OfficeSubscription } from './plans-api';

// SPEC-012 frame set 3: the office's plan. Every state of the frames, the dialogs and what each
// action asks of the API.
const env = vi.hoisted(() => ({ api: vi.fn() }));
const assign = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiJson: (...args: unknown[]) => env.api(...args) }));

const t = messages.officePlan;

const anInvoice = (n: number, overrides: Partial<Invoice> = {}): Invoice => ({
  id: `in_${n}`,
  reason: 'subscription_cycle',
  periodStart: '2026-11-14T15:00:00.000Z',
  periodEnd: '2026-12-14T15:00:00.000Z',
  paidAt: '2026-11-14T15:00:00.000Z',
  amount: '449.90',
  status: 'paid',
  hostedUrl: `https://invoice.example.test/in_${n}`,
  ...overrides,
});
const page = (items: Invoice[], total = items.length, pageNumber = 1): InvoicesPage => ({
  items,
  total,
  page: pageNumber,
  pageSize: 6,
});

let subscription: OfficeSubscription;
let calls: string[];

function serve(overrides: Record<string, Handler> = {}) {
  calls = [];
  const routes: Record<string, Handler> = {
    'GET /api/office/subscription': () => subscription,
    'GET /api/plans': () => CATALOGUE,
    'GET /api/office/subscription/invoices': () => page([anInvoice(1), anInvoice(2)]),
    ...overrides,
  };
  const router = routedApi(routes);
  env.api = vi.fn(async (path: string, init?: { method?: string; json?: unknown }) => {
    calls.push(`${init?.method ?? 'GET'} ${path.split('?')[0]}`);
    return router(path, init);
  });
}
const posted = (path: string) =>
  env.api.mock.calls.find(([p, init]) => p === path && init?.method === 'POST')?.[1];

beforeEach(() => {
  subscription = aSubscription();
  vi.stubGlobal('location', { assign });
  serve();
});
afterEach(() => {
  vi.useRealTimers();
  env.api.mockReset();
  assign.mockReset();
  vi.unstubAllGlobals();
});

describe('OfficePlanPage active (frame o1)', () => {
  it.each(['light', 'dark'] as const)(
    'shows the plan, the usage against the limit, the next charge and the history, and passes axe (%s)',
    async (scheme) => {
      const { container } = render(<OfficePlanPage />, { scheme });

      expect(await screen.findByRole('heading', { level: 1, name: t.title })).toBeVisible();
      const card = (await screen.findByRole('heading', { level: 2, name: 'Profissional' })).closest(
        'section',
      ) as HTMLElement;
      expect(card).toHaveTextContent('Plano atual');
      expect(card).toHaveTextContent('Ativo');
      expect(card).toHaveTextContent('R$ 449,90 por mês · 5 jornadas simultâneas');
      expect(card).toHaveTextContent('4 de 5 jornadas em andamento');
      expect(card).toHaveTextContent('1 vaga livre');
      const bar = within(card).getByRole('progressbar', { name: t.usage.label });
      expect(bar).toHaveAttribute('aria-valuenow', '4');
      expect(bar).toHaveAttribute('aria-valuemax', '5');
      expect(card).toHaveTextContent('Próxima cobrança14/12/2026');
      expect(card).toHaveTextContent('Valor da próxima cobrançaR$ 449,90');
      expect(card).toHaveTextContent('Assinante desde14/06/2026');
      expect(card).toHaveTextContent('Período atual14/11/2026 a 14/12/2026');
      expect(card).toHaveTextContent(t.current.datesNote);
      expect(screen.getByRole('button', { name: t.actions.change })).toBeEnabled();
      expect(screen.getByRole('button', { name: t.actions.payment })).toBeVisible();
      // cancelling lives in its own section, away from the common actions
      expect(screen.getByRole('heading', { level: 2, name: t.cancel.title })).toBeVisible();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('the plan page asks for the history on its own route, six a page, for the same office', async () => {
    render(<OfficePlanPage />);
    await screen.findAllByRole('row');

    expect(env.api).toHaveBeenCalledWith(
      `/api/office/subscription/invoices?officeId=${OFFICE_ID}&page=1&pageSize=6`,
    );
  });
});

describe('OfficePlanPage billing history (BR-012-11, owner decision 12)', () => {
  it('describes each charge, marks its state with a label and links to the invoice', async () => {
    serve({
      'GET /api/office/subscription/invoices': () =>
        page([
          anInvoice(1),
          anInvoice(2, {
            reason: 'subscription_update',
            paidAt: '2026-10-02T15:00:00.000Z',
            amount: '118.40',
          }),
          anInvoice(3, { status: 'uncollectible', paidAt: null }),
          anInvoice(4, {
            status: 'open',
            reason: 'other',
            periodStart: null,
            periodEnd: null,
            hostedUrl: null,
          }),
        ]),
    });
    render(<OfficePlanPage />);

    const rows = await screen.findAllByRole('row');
    const table = rows[0]?.closest('table') as HTMLElement;
    expect(table).toHaveTextContent('Assinatura · 14/11/2026 a 14/12/2026');
    expect(within(table).getByText(t.history.proration)).toBeVisible();
    expect(within(table).getByText(t.history.failed)).toBeVisible();
    expect(within(table).getByText(t.history.open)).toBeVisible();
    expect(within(table).getByText('R$ 118,40')).toBeVisible();
    const link = within(table).getAllByRole('link')[0] as HTMLElement;
    expect(link).toHaveAccessibleName('Ver fatura de 14/11/2026');
    expect(link).toHaveAttribute('href', 'https://invoice.example.test/in_1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows six rows and "Ver mais cobranças" appends the next page until the history is complete', async () => {
    const user = userEvent.setup();
    serve({
      'GET /api/office/subscription/invoices': (init) => void init,
    });
    env.api = vi.fn(async (path: string, init?: { method?: string }) => {
      if (path === '/api/office/subscription') return subscription;
      if (path === '/api/plans') return CATALOGUE;
      if (path.includes('page=2')) return page([anInvoice(7), anInvoice(8)], 8, 2);
      if (path.includes('/invoices'))
        return page(
          [1, 2, 3, 4, 5, 6].map((n) => anInvoice(n)),
          8,
          1,
        );
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });
    render(<OfficePlanPage />);
    const more = await screen.findByRole('button', { name: t.history.more });
    expect(screen.getAllByRole('link', { name: /Ver fatura/ })).toHaveLength(12); // table and cards

    await user.click(more);

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: t.history.more })).not.toBeInTheDocument(),
    );
    expect(env.api).toHaveBeenCalledWith(
      `/api/office/subscription/invoices?officeId=${OFFICE_ID}&page=2&pageSize=6`,
    );
    expect(screen.getAllByRole('link', { name: /Ver fatura/ })).toHaveLength(16);
  });

  it('an empty history says so; a history the provider cannot give breaks only that section, with a retry', async () => {
    const user = userEvent.setup();
    serve({ 'GET /api/office/subscription/invoices': () => page([]) });
    const { unmount } = render(<OfficePlanPage />);
    expect(await screen.findByText(t.history.empty)).toBeVisible();
    unmount();

    let fail = true;
    serve({
      'GET /api/office/subscription/invoices': () => {
        if (fail) throw new ApiError('BILLING_HISTORY_UNAVAILABLE', {}, 502);
        return page([anInvoice(1)]);
      },
    });
    render(<OfficePlanPage />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(messages.errors.BILLING_HISTORY_UNAVAILABLE);
    // the plan itself is there
    expect(screen.getByRole('heading', { level: 2, name: 'Profissional' })).toBeVisible();
    fail = false;
    await user.click(within(alert).getByRole('button', { name: t.history.retry }));
    expect(await screen.findAllByRole('row')).toHaveLength(2);
  });

  it('a failure loading more keeps what is shown and says so', async () => {
    const user = userEvent.setup();
    env.api = vi.fn(async (path: string) => {
      if (path === '/api/office/subscription') return subscription;
      if (path === '/api/plans') return CATALOGUE;
      if (path.includes('page=2')) throw new ApiError('BILLING_HISTORY_UNAVAILABLE', {}, 502);
      return page(
        [1, 2, 3, 4, 5, 6].map((n) => anInvoice(n)),
        8,
        1,
      );
    });
    render(<OfficePlanPage />);

    await user.click(await screen.findByRole('button', { name: t.history.more }));

    expect(await screen.findByText(t.history.error)).toBeVisible();
    expect(screen.getAllByRole('link', { name: /Ver fatura/ })).toHaveLength(12);
  });
});

describe('OfficePlanPage states', () => {
  it('frame o2: a scheduled change names its date, explains the count, and can be undone by choosing the current plan', async () => {
    const user = userEvent.setup();
    subscription = aSubscription({
      scheduledChange: {
        planCode: 'essencial',
        planName: 'Essencial',
        activeJourneyLimit: 2,
        price: '189.90',
        interval: 'month',
        at: '2026-12-14T15:00:00.000Z',
      },
      canUndoScheduledChange: true,
      nextChargeAmount: '189.90',
    });
    serve({ 'POST /api/office/subscription/change': () => aSubscription() });
    render(<OfficePlanPage />);

    const notice = (await screen.findByText(/Mudança para o plano Essencial em/)).closest(
      '[role="note"]',
    ) as HTMLElement;
    expect(notice).toHaveTextContent('Mudança para o plano Essencial em 14/12/2026');
    expect(notice).toHaveTextContent(
      'Até lá, o plano Profissional e o limite de 5 jornadas continuam valendo.',
    );
    expect(notice).toHaveTextContent(
      'novas jornadas só poderão ser iniciadas quando houver menos de 2 em andamento',
    );
    expect(screen.getByText(/Valor da próxima cobrança/).parentElement).toHaveTextContent(
      'R$ 189,90',
    );

    await user.click(within(notice).getByRole('button', { name: t.actions.undoChange }));

    await waitFor(() =>
      expect(posted('/api/office/subscription/change')).toEqual({
        method: 'POST',
        json: { planCode: 'profissional', officeId: OFFICE_ID },
      }),
    );
    expect(await screen.findByText(t.toast.changeUndone)).toBeVisible();
  });

  it('frame o4: the limit reached shows the exact sentence, a full bar and the way to change plan', async () => {
    subscription = aSubscription({ inProgress: 5 });
    const { container } = render(<OfficePlanPage />);

    expect(
      await screen.findByText(
        'Limite de jornadas atingido: 5 de 5. Encerre uma jornada ou mude de plano.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('progressbar', { name: t.usage.label }).className).toContain(
      'colorWarning',
    );
    expect(screen.getByText('Sem vagas livres')).toBeVisible();
    expect(screen.getAllByRole('button', { name: t.actions.change })).toHaveLength(2);
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each(['light', 'dark'] as const)(
    'frame o5: a failed renewal is an alert with the portal action, and the plan stays in effect (%s)',
    async (scheme) => {
      const user = userEvent.setup();
      subscription = aSubscription({ status: 'PAST_DUE' });
      serve({
        'POST /api/office/subscription/billing-portal': () => ({
          url: 'https://billing.example.test/s',
        }),
      });
      const { container } = render(<OfficePlanPage />, { scheme });

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Não conseguimos cobrar a renovação de 14/11/2026');
      expect(alert).toHaveTextContent('Todos os membros receberam um e-mail');
      expect(screen.getByText('Pagamento pendente')).toBeVisible();
      expect(screen.getByText('Valor pendente')).toBeVisible();
      expect(await axe(container)).toHaveNoViolations();

      await user.click(within(alert).getByRole('button', { name: t.actions.payment }));

      await waitFor(() => expect(assign).toHaveBeenCalledWith('https://billing.example.test/s'));
      expect(posted('/api/office/subscription/billing-portal')).toEqual({
        method: 'POST',
        json: { officeId: OFFICE_ID },
      });
    },
  );

  it.each(['javascript:alert(1)', 'http://billing.example.test/s', 'garbage'])(
    'never follows a portal URL that is not https (%s)',
    async (url) => {
      const user = userEvent.setup();
      serve({ 'POST /api/office/subscription/billing-portal': () => ({ url }) });
      render(<OfficePlanPage />);

      await user.click(await screen.findByRole('button', { name: t.actions.payment }));

      expect(await screen.findByText(messages.errors.BILLING_PORTAL_FAILED)).toBeVisible();
      expect(assign).not.toHaveBeenCalled();
    },
  );

  it('an invoice page that is not https is no link at all', async () => {
    serve({
      'GET /api/office/subscription/invoices': () =>
        page([
          anInvoice(1, { hostedUrl: 'javascript:alert(1)' }),
          anInvoice(2, { hostedUrl: 'http://invoice.example.test/in_2' }),
          anInvoice(3),
        ]),
    });
    render(<OfficePlanPage />);

    await screen.findAllByRole('row');
    const links = screen.getAllByRole('link', { name: /Ver fatura/ });
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://invoice.example.test/in_3',
      'https://invoice.example.test/in_3',
    ]);
  });

  it('a portal that cannot be opened is an error toast, and the button is free again', async () => {
    const user = userEvent.setup();
    serve({
      'POST /api/office/subscription/billing-portal': () => {
        throw new ApiError('BILLING_PORTAL_FAILED', {}, 502);
      },
    });
    render(<OfficePlanPage />);

    await user.click(await screen.findByRole('button', { name: t.actions.payment }));

    expect(await screen.findByText(messages.errors.BILLING_PORTAL_FAILED)).toBeVisible();
    expect(screen.getByRole('button', { name: t.actions.payment })).toBeEnabled();
  });

  it('frame o6 and owner decision 4: a scheduled cancellation offers only "Desfazer cancelamento", and no change or cancel', async () => {
    const user = userEvent.setup();
    subscription = aSubscription({
      status: 'CANCELING',
      cancelAtPeriodEnd: true,
      canUndoCancel: true,
      nextChargeAmount: null,
    });
    serve({ 'POST /api/office/subscription/undo-cancel': () => aSubscription() });
    const { container } = render(<OfficePlanPage />);

    const notice = (
      await screen.findByText('Cancelamento agendado', { selector: 'p, div, h6' })
    ).closest('[role="note"]') as HTMLElement;
    expect(notice).toHaveTextContent('O plano continua ativo até 14/12/2026 e não será renovado.');
    expect(screen.queryByRole('button', { name: t.actions.change })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.cancel.action })).not.toBeInTheDocument();
    expect(screen.getByText('Plano ativo até').nextSibling).toHaveTextContent('14/12/2026');
    expect(screen.getByText('Nenhuma')).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();

    await user.click(within(notice).getByRole('button', { name: t.actions.undoCancel }));

    await waitFor(() =>
      expect(posted('/api/office/subscription/undo-cancel')).toEqual({
        method: 'POST',
        json: { officeId: OFFICE_ID },
      }),
    );
    expect(await screen.findByText(t.toast.cancelUndone)).toBeVisible();
  });

  it('a cancellation whose period has ended cannot be undone: no action, only the date', async () => {
    subscription = aSubscription({
      status: 'CANCELING',
      cancelAtPeriodEnd: true,
      canUndoCancel: false,
    });
    render(<OfficePlanPage />);

    await screen.findByText('Cancelamento agendado', { selector: 'p, div, h6' });
    expect(screen.queryByRole('button', { name: t.actions.undoCancel })).not.toBeInTheDocument();
  });

  it.each(['light', 'dark'] as const)(
    'frame o7: lapsed in the grace period: the exact title, a zero limit, the journeys still going and "Assinar novamente" (%s)',
    async (scheme) => {
      subscription = aSubscription({
        status: 'LAPSED',
        activeJourneyLimit: 0,
        lapsedAt: '2026-11-12T15:00:00.000Z',
        readOnlyAt: '2026-11-22T15:00:00.000Z',
        nextChargeAmount: null,
      });
      const { container } = render(<OfficePlanPage />, { scheme });

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(
        'Plano encerrado em 12/11/2026. Escritório fica somente leitura em 22/11/2026.',
      );
      expect(within(alert).getByRole('link', { name: t.actions.resubscribe })).toHaveAttribute(
        'href',
        '/plans',
      );
      expect(screen.getByText('Último plano')).toBeVisible();
      expect(screen.getByText('Profissional · limite atual de 0 jornadas')).toBeVisible();
      expect(screen.getByText(t.usage.lapsedGrace)).toBeVisible();
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: t.actions.change })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: t.cancel.action })).not.toBeInTheDocument();
      expect(screen.getByText('Somente leitura a partir de')).toBeVisible();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('frame o8: read-only: the exact title and what is kept, with the date it became read-only', async () => {
    subscription = aSubscription({
      status: 'LAPSED',
      activeJourneyLimit: 0,
      lapsedAt: '2026-11-01T15:00:00.000Z',
      readOnlyAt: '2026-11-11T15:00:00.000Z',
      readOnly: true,
    });
    render(<OfficePlanPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Escritório somente leitura. Assine novamente para voltar a editar.',
    );
    expect(alert).toHaveTextContent(
      'O plano foi encerrado em 01/11/2026 e a carência de 10 dias terminou em 11/11/2026.',
    );
    expect(screen.getByText(t.usage.lapsedReadOnly)).toBeVisible();
    expect(screen.getByText('Somente leitura desde')).toBeVisible();
  });

  it('frame o9: no office is the empty state that points to the plans (a non-member and an office that never paid)', async () => {
    for (const code of ['FORBIDDEN', 'SUBSCRIPTION_NOT_FOUND']) {
      serve({
        'GET /api/office/subscription': () => {
          throw new ApiError(code, {}, code === 'FORBIDDEN' ? 403 : 404);
        },
      });
      const { unmount, container } = render(<OfficePlanPage />);

      expect(await screen.findByRole('heading', { name: t.empty.title })).toBeVisible();
      expect(screen.getByRole('link', { name: t.empty.action })).toHaveAttribute('href', '/plans');
      expect(await axe(container)).toHaveNoViolations();
      unmount();
    }
  });

  it('frames o10 and o11: skeletons with a status while loading; the error state with the code message and a retry', async () => {
    const user = userEvent.setup();
    let fail = true;
    serve({
      'GET /api/office/subscription': () => {
        if (fail) throw new ApiError('INTERNAL_ERROR', {}, 500);
        return subscription;
      },
    });
    render(<OfficePlanPage />);
    expect(screen.getByRole('status')).toHaveTextContent(t.loading);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t.error.title);
    expect(alert).toHaveTextContent(messages.errors.INTERNAL_ERROR);
    fail = false;
    await user.click(screen.getByRole('button', { name: /tentar novamente/i }));

    expect(await screen.findByRole('heading', { level: 2, name: 'Profissional' })).toBeVisible();
  });
});

describe('OfficePlanPage changing the plan (frames o3, o13, o14)', () => {
  const upgradePreview = {
    change: 'upgrade',
    amountDue: '100.00',
    currency: 'BRL',
    lines: [{ amount: '100.00' }],
    effectiveAt: null,
    nextChargeAt: '2026-12-14T15:00:00.000Z',
    nextChargeAmount: '12990.00',
  };

  it('a downgrade is scheduled: the dialog closes, the toast says so and the plan is read again', async () => {
    const user = userEvent.setup();
    serve({
      'POST /api/office/subscription/change-preview': () => ({
        change: 'schedule',
        amountDue: '0.00',
        currency: 'BRL',
        lines: [],
        effectiveAt: '2026-12-14T15:00:00.000Z',
        nextChargeAt: '2026-12-14T15:00:00.000Z',
        nextChargeAmount: '189.90',
      }),
      'POST /api/office/subscription/change': () => subscription,
    });
    render(<OfficePlanPage />);

    await user.click(await screen.findByRole('button', { name: t.actions.change }));
    const dialog = await screen.findByRole('dialog', { name: messages.plans.change.title });
    await user.click(within(dialog).getByRole('radio', { name: 'Essencial' }));
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: messages.plans.change.confirm }),
      ).toBeEnabled(),
    );
    await user.click(within(dialog).getByRole('button', { name: messages.plans.change.confirm }));

    expect(await screen.findByText('Mudança para o plano Essencial agendada')).toBeVisible();
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: messages.plans.change.title }),
      ).not.toBeInTheDocument(),
    );
    expect(
      calls.filter((call) => call === 'GET /api/office/subscription').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('frame o3: an upgrade that is not paid yet keeps the old plan, says it is waiting, disables "Mudar de plano" and looks again until the new plan arrives', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    serve({
      'POST /api/office/subscription/change-preview': () => upgradePreview,
      // the provider has not billed the new price yet: the answer still shows the old plan
      'POST /api/office/subscription/change': () => subscription,
    });
    render(<OfficePlanPage />);

    await user.click(await screen.findByRole('button', { name: t.actions.change }));
    const dialog = await screen.findByRole('dialog', { name: messages.plans.change.title });
    await user.click(within(dialog).getByRole('radio', { name: 'Avançado' }));
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: messages.plans.change.confirm }),
      ).toBeEnabled(),
    );
    await user.click(within(dialog).getByRole('button', { name: messages.plans.change.confirm }));

    const waiting = await screen.findByText(
      'Aguardando confirmação do pagamento do plano Avançado',
    );
    expect(waiting.closest('[role="status"]')).toHaveTextContent(
      'O novo limite de 15 jornadas vale a partir da confirmação do pagamento proporcional. Esta página atualiza sozinha.',
    );
    // the dialog is still leaving the screen for a moment: the page behind it is not accessible yet
    await waitFor(() =>
      expect(screen.getByRole('button', { name: t.actions.change })).toBeDisabled(),
    );

    // the provider confirms the prorated payment
    subscription = aSubscription({
      plan: { code: 'avancado', name: 'Avançado', price: '12990.00', interval: 'year' },
      activeJourneyLimit: 15,
    });
    await act(() => vi.advanceTimersByTimeAsync(UPGRADE_POLL_INTERVAL_MS));

    expect(await screen.findByRole('heading', { level: 2, name: 'Avançado' })).toBeVisible();
    await waitFor(() =>
      expect(
        screen.queryByText(/Aguardando confirmação do pagamento do plano/),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: t.actions.change })).toBeEnabled();
  });

  it('stops looking after the bounded wait, so an unpaid upgrade does not poll for ever', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    serve({
      'POST /api/office/subscription/change-preview': () => upgradePreview,
      'POST /api/office/subscription/change': () => subscription,
    });
    render(<OfficePlanPage />);
    await user.click(await screen.findByRole('button', { name: t.actions.change }));
    const dialog = await screen.findByRole('dialog', { name: messages.plans.change.title });
    await user.click(within(dialog).getByRole('radio', { name: 'Avançado' }));
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: messages.plans.change.confirm }),
      ).toBeEnabled(),
    );
    await user.click(within(dialog).getByRole('button', { name: messages.plans.change.confirm }));
    await screen.findByText('Aguardando confirmação do pagamento do plano Avançado');

    await act(() => vi.advanceTimersByTimeAsync(UPGRADE_MAX_WAIT_MS + UPGRADE_POLL_INTERVAL_MS));

    await waitFor(() =>
      expect(
        screen.queryByText(/Aguardando confirmação do pagamento do plano/),
      ).not.toBeInTheDocument(),
    );
    const reads = calls.filter((call) => call === 'GET /api/office/subscription').length;
    await act(() => vi.advanceTimersByTimeAsync(UPGRADE_POLL_INTERVAL_MS * 4));
    expect(calls.filter((call) => call === 'GET /api/office/subscription')).toHaveLength(reads);
  });
});

describe('OfficePlanPage cancelling (frames o15, o16)', () => {
  it.each(['light', 'dark'] as const)(
    'frame o15: the dialog names the date, the limit and the grace period, puts "Manter plano" first, and confirms through the API (%s)',
    async (scheme) => {
      const user = userEvent.setup();
      serve({
        'POST /api/office/subscription/cancel': () =>
          aSubscription({ status: 'CANCELING', cancelAtPeriodEnd: true }),
      });
      render(<OfficePlanPage />, { scheme });

      await user.click(await screen.findByRole('button', { name: t.cancel.action }));

      const dialog = await screen.findByRole('alertdialog', {
        name: 'Cancelar a assinatura do plano Profissional?',
      });
      expect(dialog).toHaveAccessibleDescription(
        /A assinatura deixa de ser renovada\. Você pode desfazer o cancelamento até 14\/12\/2026\./,
      );
      expect(dialog).toHaveTextContent('com o limite de 5 jornadas');
      expect(dialog).toHaveTextContent('Por 10 dias o restante continua funcionando');
      expect(dialog).toHaveTextContent('Não há reembolso do período já pago.');
      expect(await axe(dialog)).toHaveNoViolations();
      const buttons = within(dialog).getAllByRole('button');
      expect(buttons.map((b) => b.textContent)).toEqual([
        t.cancel.dialog.keep,
        t.cancel.dialog.confirm,
      ]);
      expect(buttons[0]).toHaveFocus();

      await user.click(buttons[1] as HTMLElement);

      await waitFor(() =>
        expect(posted('/api/office/subscription/cancel')).toEqual({
          method: 'POST',
          json: { officeId: OFFICE_ID },
        }),
      );
      expect(await screen.findByText(t.toast.canceled)).toBeVisible();
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    },
  );

  it('frame o16: inside the refund window the dialog says it is irreversible, refunds in full and ends the plan at once', async () => {
    const user = userEvent.setup();
    subscription = aSubscription({
      firstPaidAt: '2026-11-12T15:00:00.000Z',
      refundEligibleUntil: '2026-11-19T15:00:00.000Z',
    });
    serve({
      'POST /api/office/subscription/cancel': () =>
        aSubscription({ status: 'LAPSED', activeJourneyLimit: 0 }),
    });
    render(<OfficePlanPage />);

    expect(
      await screen.findByText(/Você está dentro do prazo de 7 dias da primeira assinatura/),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: t.cancel.action }));

    const dialog = await screen.findByRole('alertdialog', { name: t.cancel.refund.title });
    expect(dialog).toHaveTextContent('Você assinou em 12/11/2026, dentro do prazo de 7 dias.');
    expect(dialog).toHaveTextContent(
      'devolvemos o valor integral que você pagou e o plano termina imediatamente',
    );
    expect(within(dialog).getByText('Isso não pode ser desfeito.').tagName).toBe('STRONG');
    expect(dialog).toHaveTextContent(
      'Por 10 dias, as jornadas em andamento e os cadastros continuam funcionando.',
    );
    await user.click(within(dialog).getByRole('button', { name: t.cancel.refund.confirm }));

    expect(await screen.findByText(t.toast.canceledRefund)).toBeVisible();
  });

  it('a cancel that fails stays in the dialog flow: the error is shown on the page and the dialog stays open', async () => {
    const user = userEvent.setup();
    serve({
      'POST /api/office/subscription/cancel': () => {
        throw new ApiError('CANCEL_IN_PROGRESS', {}, 409);
      },
    });
    render(<OfficePlanPage />);

    await user.click(await screen.findByRole('button', { name: t.cancel.action }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: t.cancel.dialog.confirm }));

    expect(await screen.findByText(messages.errors.CANCEL_IN_PROGRESS)).toBeVisible();
    expect(screen.getByRole('alertdialog')).toBeVisible();
  });
});

describe('OfficePlanPage cancelling: owner review #173', () => {
  const eligible = () =>
    aSubscription({
      firstPaidAt: '2026-11-12T15:00:00.000Z',
      refundEligibleUntil: '2026-11-19T15:00:00.000Z',
    });

  it('finding 2: a dialog opened under a refund that has since run out is not confirmed silently: it reloads, shows the new text and asks again', async () => {
    const user = userEvent.setup();
    subscription = eligible();
    serve({
      'POST /api/office/subscription/cancel': () =>
        aSubscription({ status: 'CANCELING', cancelAtPeriodEnd: true }),
    });
    render(<OfficePlanPage />);
    await user.click(await screen.findByRole('button', { name: t.cancel.action }));
    const dialog = await screen.findByRole('alertdialog', { name: t.cancel.refund.title });

    // the window ran out while the page was open: the server now judges it as an ordinary cancel
    subscription = aSubscription();
    await user.click(within(dialog).getByRole('button', { name: t.cancel.refund.confirm }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t.cancel.changed);
    const again = await screen.findByRole('alertdialog', {
      name: 'Cancelar a assinatura do plano Profissional?',
    });
    expect(again).toHaveTextContent('Não há reembolso do período já pago.');
    expect(posted('/api/office/subscription/cancel')).toBeUndefined();
    expect(screen.queryByText(t.toast.canceledRefund)).not.toBeInTheDocument();

    // confirming the new text cancels at the end of the period and says exactly that
    await user.click(within(again).getByRole('button', { name: t.cancel.dialog.confirm }));
    expect(await screen.findByText(t.toast.canceled)).toBeVisible();
    expect(screen.queryByText(t.toast.canceledRefund)).not.toBeInTheDocument();
  });

  it('finding 2: the message follows what the server answered, not the eligibility the page held', async () => {
    const user = userEvent.setup();
    subscription = eligible();
    // the read just before confirming still says eligible; the server judges at the request and
    // schedules the end of the period (no refund)
    serve({
      'POST /api/office/subscription/cancel': () =>
        aSubscription({ status: 'CANCELING', cancelAtPeriodEnd: true }),
    });
    render(<OfficePlanPage />);
    await user.click(await screen.findByRole('button', { name: t.cancel.action }));
    const dialog = await screen.findByRole('alertdialog', { name: t.cancel.refund.title });

    await user.click(within(dialog).getByRole('button', { name: t.cancel.refund.confirm }));

    expect(await screen.findByText(t.toast.canceled)).toBeVisible();
    expect(screen.queryByText(t.toast.canceledRefund)).not.toBeInTheDocument();
  });

  it('finding 4: "Manter plano" cannot dismiss the dialog while the cancellation is in flight', async () => {
    const user = userEvent.setup();
    let release: (value: OfficeSubscription) => void = () => undefined;
    serve({
      'POST /api/office/subscription/cancel': () =>
        new Promise<OfficeSubscription>((resolve) => {
          release = resolve;
        }),
    });
    render(<OfficePlanPage />);
    await user.click(await screen.findByRole('button', { name: t.cancel.action }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: t.cancel.dialog.confirm }));

    const keep = await within(dialog).findByRole('button', { name: t.cancel.dialog.keep });
    expect(keep).toBeDisabled();
    fireEvent.click(keep); // a click that reaches it anyway does nothing
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeVisible();

    await act(async () => {
      release(aSubscription({ status: 'CANCELING', cancelAtPeriodEnd: true }));
    });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(await screen.findByText(t.toast.canceled)).toBeVisible();
  });

  it('finding 6: a failed cancellation is an accessible alert inside the open dialog', async () => {
    const user = userEvent.setup();
    serve({
      'POST /api/office/subscription/cancel': () => {
        throw new ApiError('CANCEL_IN_PROGRESS', {}, 409);
      },
    });
    render(<OfficePlanPage />);
    await user.click(await screen.findByRole('button', { name: t.cancel.action }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: t.cancel.dialog.confirm }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(messages.errors.CANCEL_IN_PROGRESS);
    expect(dialog).toContainElement(alert);
    // the page behind the modal is not where the error is
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    // closing and opening again starts clean
    await user.click(within(dialog).getByRole('button', { name: t.cancel.dialog.keep }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: t.cancel.action }));
    expect(within(await screen.findByRole('alertdialog')).queryByRole('alert')).toBeNull();
  });
});
