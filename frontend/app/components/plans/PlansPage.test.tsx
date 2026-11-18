import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-error';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import PlansPage from './PlansPage';
import {
  AVANCADO,
  CATALOGUE,
  ESSENCIAL,
  OFFICE_ID,
  PROFISSIONAL,
  aSubscription,
  routedApi,
  type Handler,
} from './plans-test-support';

// SPEC-012 frame set 1: where the visitor stands decides what each card offers. Stripe is behind
// the backend (the BFF answers with a checkout URL), so the browser only navigates to it (TS-07).
const env = vi.hoisted(() => ({ auth: {} as Record<string, unknown>, api: vi.fn() }));
const assign = vi.fn();

vi.mock('@/app/contexts/AuthContext', () => ({ useAuth: () => env.auth }));
vi.mock('@/lib/api-client', () => ({ apiJson: (...args: unknown[]) => env.api(...args) }));

const t = messages.plans;
const visitor = { loading: false, isAuthenticated: false, personas: [] as string[] };
const signedIn = { loading: false, isAuthenticated: true, personas: ['searcher'] };
const officeMember = { loading: false, isAuthenticated: true, personas: ['searcher', 'advisor'] };

function serve(routes: Record<string, Handler> = {}) {
  env.api = routedApi({ 'GET /api/plans': () => CATALOGUE, ...routes });
}
const callsTo = (key: string) =>
  env.api.mock.calls.filter(
    ([path, init]) =>
      `${(init as { method?: string } | undefined)?.method ?? 'GET'} ${path}` === key,
  );

beforeEach(() => {
  env.auth = visitor;
  vi.stubGlobal('location', { assign });
  serve();
});

afterEach(() => {
  env.api.mockReset();
  assign.mockReset();
  vi.unstubAllGlobals();
});

describe('PlansPage as a visitor (frame s1)', () => {
  it.each(['light', 'dark'] as const)(
    'lists the catalogue from the API with "Entrar para assinar", the refund notice and no highlight (%s)',
    async (scheme) => {
      const { container } = render(<PlansPage />, { scheme });

      const cards = await screen.findAllByRole('article');
      expect(
        cards.map((card) => within(card).getByRole('heading', { level: 2 }).textContent),
      ).toEqual(['Essencial', 'Profissional', 'Avançado']);
      expect(screen.getByRole('heading', { level: 1, name: t.title })).toBeVisible();
      expect(screen.getByText(t.subtitle.public)).toBeVisible();
      expect(cards[0]).toHaveTextContent('R$ 189,90');
      expect(cards[2]).toHaveTextContent('R$ 12.990,00');
      expect(cards[2]).toHaveTextContent('/ano');
      expect(cards[1]).toHaveTextContent('5 jornadas simultâneas');
      // owner decisions 6 and 9: no "most popular", the notice on every variant, 7 from the API
      expect(screen.queryByText(/popular/i)).not.toBeInTheDocument();
      expect(
        screen.getByText(
          'Na primeira assinatura do escritório, cancele em até 7 dias após a cobrança e receba o reembolso integral.',
        ),
      ).toBeVisible();
      // owner decision 5: no coupon field until SPEC-026
      expect(screen.queryByPlaceholderText(/cupom/i)).not.toBeInTheDocument();
      const links = screen.getAllByRole('link', { name: 'Entrar para assinar' });
      expect(links).toHaveLength(3);
      for (const link of links) expect(link).toHaveAttribute('href', '/login?next=%2Fplans');
      expect(callsTo('GET /api/office/subscription')).toHaveLength(0);
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('words the notice from the setting, not from a constant', async () => {
    serve({ 'GET /api/plans': () => ({ ...CATALOGUE, refundWindowDays: 14 }) });
    render(<PlansPage />);

    expect(await screen.findByText(/cancele em até 14 dias após a cobrança/)).toBeVisible();
  });

  it('shows skeletons with a polite status while loading, then the empty state when nothing is offered', async () => {
    serve({ 'GET /api/plans': () => ({ items: [], refundWindowDays: 7 }) });
    render(<PlansPage />);

    expect(screen.getByRole('status')).toHaveTextContent(t.loading);
    expect(await screen.findByRole('heading', { name: t.empty.title })).toBeVisible();
    expect(screen.getByRole('link', { name: t.empty.action })).toHaveAttribute('href', '/search');
  });

  it('shows the error state with the code message and reads again on retry', async () => {
    const user = userEvent.setup();
    let fail = true;
    serve({
      'GET /api/plans': () => {
        if (fail) throw new ApiError('INTERNAL_ERROR', {}, 500);
        return CATALOGUE;
      },
    });
    const { container } = render(<PlansPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t.error.title);
    expect(alert).toHaveTextContent(messages.errors.INTERNAL_ERROR);
    expect(alert).toHaveTextContent('INTERNAL_ERROR');
    expect(await axe(container)).toHaveNoViolations();

    fail = false;
    await user.click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(await screen.findAllByRole('article')).toHaveLength(3);
  });

  it('waits for the session lookup before deciding what to offer', async () => {
    env.auth = { ...visitor, loading: true };
    render(<PlansPage />);

    expect(screen.getByRole('status')).toHaveTextContent(t.loading);
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});

describe('PlansPage signed in without an office (frame s2, s6, s7)', () => {
  beforeEach(() => {
    env.auth = signedIn;
  });

  it('subscribes through the hosted checkout, busy until the browser leaves, the other cards off', async () => {
    const user = userEvent.setup();
    let release: (value: unknown) => void = () => undefined;
    serve({
      'POST /api/office/subscription/checkout': () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    render(<PlansPage />);
    const cards = await screen.findAllByRole('article');

    await user.click(within(cards[1] as HTMLElement).getByRole('button', { name: 'Assinar' }));

    const busy = await screen.findByRole('button', { name: t.cta.opening });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByRole('button', { name: 'Assinar' })).toHaveLength(2);
    for (const other of screen.getAllByRole('button', { name: 'Assinar' })) {
      expect(other).toBeDisabled();
    }
    expect(callsTo('POST /api/office/subscription/checkout')[0]?.[1]).toEqual({
      method: 'POST',
      json: { planCode: 'profissional' },
    });

    release({ url: 'https://checkout.example.test/cs_1' });
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.example.test/cs_1'));
  });

  it('frame s7: a failed checkout says so in an alert with no retry button, and frees the cards', async () => {
    const user = userEvent.setup();
    serve({
      'POST /api/office/subscription/checkout': () => {
        throw new ApiError('CHECKOUT_SESSION_FAILED', {}, 502);
      },
    });
    const { container } = render(<PlansPage />);

    await user.click((await screen.findAllByRole('button', { name: 'Assinar' }))[0] as HTMLElement);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t.checkoutError.title);
    expect(alert).toHaveTextContent(t.checkoutError.failed);
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Assinar' })[1]).toBeEnabled();
    expect(assign).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the catalogue text of another refusal, such as an office that cannot be created yet', async () => {
    const user = userEvent.setup();
    serve({
      'POST /api/office/subscription/checkout': () => {
        throw new ApiError('OFFICE_CREATION_UNAVAILABLE', {}, 503);
      },
    });
    render(<PlansPage />);

    await user.click((await screen.findAllByRole('button', { name: 'Assinar' }))[0] as HTMLElement);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      messages.errors.OFFICE_CREATION_UNAVAILABLE,
    );
  });
});

describe('PlansPage as an office member (frames s3, s4, s5)', () => {
  beforeEach(() => {
    env.auth = officeMember;
  });

  it.each(['light', 'dark'] as const)(
    'marks the current plan, shows the summary and what each change does, and links to the office plan (%s)',
    async (scheme) => {
      serve({ 'GET /api/office/subscription': () => aSubscription() });
      const { container } = render(<PlansPage />, { scheme });

      const cards = await screen.findAllByRole('article');
      expect(screen.getByText(t.subtitle.member)).toBeVisible();
      expect(screen.getByText(t.summary.label)).toBeVisible();
      expect(within(cards[1] as HTMLElement).getByText('Plano atual')).toBeVisible();
      expect(within(cards[1] as HTMLElement).getByText(t.hint.currentPlan)).toBeVisible();
      expect(
        within(cards[1] as HTMLElement).getByRole('link', { name: t.cta.viewOffice }),
      ).toHaveAttribute('href', '/office/plan');
      expect(cards[0]).toHaveTextContent('Vale a partir do próximo período (14/12/2026).');
      expect(cards[2]).toHaveTextContent(t.hint.upgrade);
      expect(screen.getAllByRole('button', { name: t.cta.change })).toHaveLength(2);
      expect(
        screen.getByText(/Na primeira assinatura do escritório, cancele em até 7 dias/),
      ).toBeVisible();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('frame s4: a plan that left the catalogue is still the office plan, explained, and no card is "current"', async () => {
    serve({
      'GET /api/office/subscription': () =>
        aSubscription({
          plan: { code: 'classico', name: 'Clássico', price: '329.90', interval: 'month' },
          activeJourneyLimit: 3,
        }),
    });
    render(<PlansPage />);

    await screen.findAllByRole('article');
    expect(screen.getByText(/Este plano não está mais à venda/)).toHaveTextContent(
      'O escritório mantém o preço de R$ 329,90 por mês e o limite de 3 jornadas até mudar ou cancelar.',
    );
    expect(screen.queryByText('Plano atual')).not.toBeInTheDocument();
  });

  it('owner decision 4: while a cancellation is scheduled every card only leads to the office plan', async () => {
    serve({
      'GET /api/office/subscription': () =>
        aSubscription({ status: 'CANCELING', cancelAtPeriodEnd: true }),
    });
    render(<PlansPage />);

    await screen.findAllByRole('article');
    expect(screen.queryByRole('button', { name: t.cta.change })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: t.cta.viewOffice })).toHaveLength(4);
  });

  it('frame s5: a lapsed office sees the lapse and "Assinar novamente", which checks out for that office', async () => {
    const user = userEvent.setup();
    serve({
      'GET /api/office/subscription': () =>
        aSubscription({
          status: 'LAPSED',
          activeJourneyLimit: 0,
          lapsedAt: '2026-11-12T15:00:00.000Z',
          readOnlyAt: '2026-11-22T15:00:00.000Z',
        }),
      'POST /api/office/subscription/checkout': () => ({
        url: 'https://checkout.example.test/cs_2',
      }),
    });
    render(<PlansPage />);

    expect(await screen.findByText(/O plano do escritório foi encerrado em/)).toHaveTextContent(
      'O plano do escritório foi encerrado em 12/11/2026',
    );
    expect(screen.getByText(t.lapsed.text)).toBeVisible();
    await user.click(
      screen.getAllByRole('button', { name: t.cta.subscribeAgain })[2] as HTMLElement,
    );

    expect(callsTo('POST /api/office/subscription/checkout')[0]?.[1]).toEqual({
      method: 'POST',
      json: { planCode: 'avancado', officeId: OFFICE_ID },
    });
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.example.test/cs_2'));
  });

  it('"Mudar para este plano" opens the change dialog with that plan chosen, and a confirmed change reloads the plan', async () => {
    const user = userEvent.setup();
    let subscription = aSubscription();
    serve({
      'GET /api/office/subscription': () => subscription,
      'POST /api/office/subscription/change-preview': () => ({
        change: 'schedule',
        amountDue: '0.00',
        currency: 'BRL',
        lines: [],
        effectiveAt: '2026-12-14T15:00:00.000Z',
        nextChargeAt: '2026-12-14T15:00:00.000Z',
        nextChargeAmount: '189.90',
      }),
      'POST /api/office/subscription/change': () => {
        subscription = aSubscription({
          scheduledChange: {
            planCode: 'essencial',
            planName: 'Essencial',
            activeJourneyLimit: 2,
            price: '189.90',
            interval: 'month',
            at: '2026-12-14T15:00:00.000Z',
          },
        });
        return subscription;
      },
    });
    render(<PlansPage />);
    const cards = await screen.findAllByRole('article');

    await user.click(within(cards[0] as HTMLElement).getByRole('button', { name: t.cta.change }));

    const dialog = await screen.findByRole('dialog', { name: t.change.title });
    expect(await within(dialog).findByRole('radio', { name: 'Essencial' })).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: t.change.confirm }));

    expect(await screen.findByText('Mudança para o plano Essencial agendada')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(callsTo('GET /api/office/subscription').length).toBeGreaterThanOrEqual(2);
    expect(ESSENCIAL.code).toBe('essencial');
    expect(PROFISSIONAL.code).toBe('profissional');
    expect(AVANCADO.code).toBe('avancado');
  });

  it('a failure reading the office plan is the page error, not a catalogue that offers a second subscription', async () => {
    serve({
      'GET /api/office/subscription': () => {
        throw new ApiError('INTERNAL_ERROR', {}, 500);
      },
    });
    render(<PlansPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(t.error.title);
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});
