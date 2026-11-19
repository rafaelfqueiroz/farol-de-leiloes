import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-error';
import { notifyBillingChanged } from '@/lib/billing-events';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import BillingBanner, { billingNoticeOf } from './BillingBanner';
import type { OfficeSubscription } from './plans-api';
import { aSubscription, routedApi, type Handler } from './plans-test-support';

// SPEC-012 owner decision 1 (frame o18): the billing notices of an office in the shell's banner.
const env = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  pathname: '/search',
  api: vi.fn(),
  report: vi.fn(),
}));
const assign = vi.fn();

vi.mock('@/app/contexts/AuthContext', () => ({ useAuth: () => env.auth }));
vi.mock('next/navigation', () => ({ usePathname: () => env.pathname }));
vi.mock('@/lib/api-client', () => ({ apiJson: (...args: unknown[]) => env.api(...args) }));
vi.mock('@/lib/report-client-error', () => ({ reportClientError: env.report }));

const t = messages.officePlan.banner;
const member = { isAuthenticated: true, user: { _id: 'u1' }, personas: ['searcher', 'advisor'] };
const PAST_DUE = aSubscription({ status: 'PAST_DUE' });
const GRACE = aSubscription({
  status: 'LAPSED',
  activeJourneyLimit: 0,
  lapsedAt: '2026-11-12T15:00:00.000Z',
  readOnlyAt: '2026-11-22T15:00:00.000Z',
});
const READ_ONLY = { ...GRACE, readOnly: true };

function serve(routes: Record<string, Handler>) {
  env.api = routedApi(routes);
}
const FALLBACK = <p>Confirme seu e-mail</p>;

beforeEach(() => {
  env.auth = member;
  env.pathname = '/search';
  vi.stubGlobal('location', { assign });
});
afterEach(() => {
  env.api.mockReset();
  env.report.mockReset();
  assign.mockReset();
  vi.unstubAllGlobals();
});

describe('billingNoticeOf', () => {
  it('names the three states that need attention and nothing else', () => {
    expect(billingNoticeOf(PAST_DUE)).toBe('pastDue');
    expect(billingNoticeOf(GRACE)).toBe('grace');
    expect(billingNoticeOf(READ_ONLY)).toBe('readOnly');
    for (const status of ['ACTIVE', 'CANCELING', 'PENDING'] as const) {
      expect(billingNoticeOf(aSubscription({ status }))).toBeNull();
    }
  });
});

describe('BillingBanner', () => {
  it.each(['light', 'dark'] as const)(
    'payment failed: a warning announced as an alert, with the action that opens the provider portal (%s)',
    async (scheme) => {
      const user = userEvent.setup();
      serve({
        'GET /api/office/subscription': () => PAST_DUE,
        'POST /api/office/subscription/billing-portal': () => ({
          url: 'https://billing.example.test/s',
        }),
      });
      const { container } = render(<BillingBanner>{FALLBACK}</BillingBanner>, { scheme });

      const banner = await screen.findByRole('alert');
      expect(banner).toHaveTextContent(t.pastDue.title);
      expect(banner).toHaveTextContent(t.pastDue.text);
      // a billing notice takes priority over the unconfirmed-e-mail one
      expect(screen.queryByText('Confirme seu e-mail')).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();

      await user.click(screen.getByRole('button', { name: t.pastDue.action }));

      expect(env.api).toHaveBeenCalledWith('/api/office/subscription/billing-portal', {
        method: 'POST',
        json: { officeId: PAST_DUE.officeId },
      });
      await waitFor(() => expect(assign).toHaveBeenCalledWith('https://billing.example.test/s'));
    },
  );

  it('never follows a portal URL that is not https, and says the portal could not be opened', async () => {
    const user = userEvent.setup();
    serve({
      'GET /api/office/subscription': () => PAST_DUE,
      'POST /api/office/subscription/billing-portal': () => ({ url: 'javascript:alert(1)' }),
    });
    render(<BillingBanner />);

    await user.click(await screen.findByRole('button', { name: t.pastDue.action }));

    expect(await screen.findByText(messages.errors.BILLING_PORTAL_FAILED)).toBeVisible();
    expect(assign).not.toHaveBeenCalled();
  });

  it('a portal that cannot be opened says so in the banner and keeps its action', async () => {
    const user = userEvent.setup();
    serve({
      'GET /api/office/subscription': () => PAST_DUE,
      'POST /api/office/subscription/billing-portal': () => {
        throw new ApiError('BILLING_PORTAL_FAILED', {}, 502);
      },
    });
    render(<BillingBanner />);

    await user.click(await screen.findByRole('button', { name: t.pastDue.action }));

    expect(await screen.findByText(messages.errors.BILLING_PORTAL_FAILED)).toBeVisible();
    expect(screen.getByRole('button', { name: t.pastDue.action })).toBeEnabled();
  });

  it.each(['light', 'dark'] as const)(
    'grace period: the lapse and the read-only date, with a link to the office plan (%s)',
    async (scheme) => {
      serve({ 'GET /api/office/subscription': () => GRACE });
      const { container } = render(<BillingBanner />, { scheme });

      const banner = await screen.findByRole('status');
      expect(banner).toHaveTextContent('Plano encerrado em 12/11/2026');
      expect(banner).toHaveTextContent('O escritório fica somente leitura em 22/11/2026.');
      expect(screen.getByRole('link', { name: t.grace.action })).toHaveAttribute(
        'href',
        '/office/plan',
      );
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('read-only: an error alert that says nothing was deleted', async () => {
    serve({ 'GET /api/office/subscription': () => READ_ONLY });
    render(<BillingBanner />);

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(t.readOnly.title);
    expect(banner).toHaveTextContent('Nada foi apagado');
    expect(screen.getByRole('link', { name: t.readOnly.action })).toHaveAttribute(
      'href',
      '/office/plan',
    );
  });

  it('says nothing for a healthy plan, and the e-mail warning keeps the slot', async () => {
    serve({ 'GET /api/office/subscription': () => aSubscription() });
    render(<BillingBanner>{FALLBACK}</BillingBanner>);

    expect(await screen.findByText('Confirme seu e-mail')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('stays out of the office plan page, which says the same in its own alert', async () => {
    env.pathname = '/office/plan';
    serve({ 'GET /api/office/subscription': () => PAST_DUE });
    render(<BillingBanner>{FALLBACK}</BillingBanner>);

    await waitFor(() => expect(env.api).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Confirme seu e-mail')).toBeVisible();
  });

  it('does not ask anything of someone who is not an office member', async () => {
    env.auth = { isAuthenticated: true, user: { _id: 'u2' }, personas: ['searcher'] };
    serve({});
    render(<BillingBanner>{FALLBACK}</BillingBanner>);

    expect(screen.getByText('Confirme seu e-mail')).toBeVisible();
    expect(env.api).not.toHaveBeenCalled();
  });

  it('reads the plan again when an action changed it, and the notice goes with the payment', async () => {
    let subscription = PAST_DUE;
    serve({ 'GET /api/office/subscription': () => subscription });
    render(<BillingBanner />);
    await screen.findByRole('alert');

    subscription = aSubscription();
    act(() => notifyBillingChanged());

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('owner review #173: an older read that resolves after a newer one never brings the notice back', async () => {
    const answers: Array<(value: OfficeSubscription) => void> = [];
    env.api = vi.fn(
      () =>
        new Promise<OfficeSubscription>((resolve) => {
          answers.push(resolve);
        }),
    );
    render(<BillingBanner>{FALLBACK}</BillingBanner>);
    await waitFor(() => expect(answers).toHaveLength(1));
    // the refresh an action triggered overtakes the initial read
    act(() => notifyBillingChanged());
    await waitFor(() => expect(answers).toHaveLength(2));

    await act(async () => {
      answers[1]?.(aSubscription()); // the newer read: ACTIVE
    });
    await act(async () => {
      answers[0]?.(PAST_DUE); // the older read, late: PAST_DUE
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Confirme seu e-mail')).toBeVisible();
  });

  it('an answer made for the previous member is dropped when the member changes', async () => {
    let answer: (value: OfficeSubscription) => void = () => undefined;
    env.api = vi.fn(
      () =>
        new Promise<OfficeSubscription>((resolve) => {
          answer = resolve;
        }),
    );
    const { rerender } = render(<BillingBanner>{FALLBACK}</BillingBanner>);
    await waitFor(() => expect(env.api).toHaveBeenCalledTimes(1));
    const late = answer;

    env.auth = { isAuthenticated: true, user: { _id: 'u2' }, personas: ['searcher'] };
    rerender(<BillingBanner>{FALLBACK}</BillingBanner>);
    await act(async () => {
      late(PAST_DUE);
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a plan that cannot be read says nothing in the shell; only an unexpected failure is reported', async () => {
    serve({
      'GET /api/office/subscription': () => {
        throw new ApiError('SUBSCRIPTION_NOT_FOUND', {}, 404);
      },
    });
    const { unmount } = render(<BillingBanner>{FALLBACK}</BillingBanner>);
    expect(await screen.findByText('Confirme seu e-mail')).toBeVisible();
    await waitFor(() => expect(env.api).toHaveBeenCalled());
    expect(env.report).not.toHaveBeenCalled();
    unmount();

    serve({
      'GET /api/office/subscription': () => {
        throw new ApiError('INTERNAL_ERROR', {}, 500);
      },
    });
    render(<BillingBanner>{FALLBACK}</BillingBanner>);
    await waitFor(() => expect(env.report).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Confirme seu e-mail')).toBeVisible();
  });
});
