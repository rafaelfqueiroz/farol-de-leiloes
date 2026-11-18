import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-error';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import PlansSuccessPage, { CHECKOUT_MAX_WAIT_MS, CHECKOUT_POLL_INTERVAL_MS } from './page';

// SPEC-012 BR-012-09, owner decision 10: the page waits for the provider's confirmation, for a
// bounded time, and never redirects by itself.
const env = vi.hoisted(() => ({ refreshUser: vi.fn(), apiJson: vi.fn() }));

vi.mock('@/app/contexts/AuthContext', () => ({
  useAuth: () => ({ refreshUser: env.refreshUser }),
}));
vi.mock('@/lib/api-client', () => ({ apiJson: env.apiJson }));

const REF = '64b7f0000000000000000a01';
const t = messages.plansResult.success;
const PLAN = {
  officeId: '64b7f0000000000000000c01',
  plan: { code: 'pro', name: 'Profissional', price: '449.90', interval: 'month' },
  activeJourneyLimit: 5,
};

/** The status answers in order (the last one repeats); the plan read after a confirmation. */
function answers(states: ('PENDING' | 'CONFIRMED' | Error)[], plan: unknown = PLAN) {
  let index = 0;
  env.apiJson.mockImplementation(async (path: string) => {
    if (path === `/api/subscriptions/checkout/${REF}/status`) {
      const next = states[Math.min(index, states.length - 1)];
      index += 1;
      if (next instanceof Error) throw next;
      return { state: next };
    }
    if (path === '/api/office/subscription') {
      if (plan instanceof Error) throw plan;
      return plan;
    }
    throw new Error(`unexpected ${path}`);
  });
}

const statusCalls = () =>
  env.apiJson.mock.calls.filter(([path]) => String(path).endsWith('/status')).length;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  env.refreshUser.mockReset().mockResolvedValue(undefined);
  env.apiJson.mockReset();
  window.history.pushState({}, '', `/plans/success?ref=${REF}`);
});

afterEach(() => {
  vi.useRealTimers();
  window.history.pushState({}, '', '/');
});

describe('PlansSuccessPage waiting (frame r1)', () => {
  it.each(['light', 'dark'] as const)(
    'says it is waiting, announces it politely and grants nothing (%s)',
    async (scheme) => {
      answers(['PENDING']);
      const { container } = render(<PlansSuccessPage />, { scheme });

      expect(await screen.findByRole('heading', { level: 1, name: t.waiting.title })).toBeVisible();
      expect(screen.getByRole('status')).toHaveTextContent(t.waiting.live);
      expect(screen.getByRole('main')).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('link', { name: t.waiting.goToSearch })).toHaveAttribute(
        'href',
        '/search',
      );
      expect(env.refreshUser).not.toHaveBeenCalled();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('asks again every few seconds and does not redirect, however long it waits', async () => {
    answers(['PENDING']);
    render(<PlansSuccessPage />);
    await screen.findByRole('heading', { level: 1, name: t.waiting.title });
    expect(statusCalls()).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(CHECKOUT_POLL_INTERVAL_MS * 3));

    expect(statusCalls()).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('heading', { level: 1, name: t.waiting.title })).toBeVisible();
    expect(window.location.pathname).toBe('/plans/success');
  });

  it('stops asking once the page is left', async () => {
    answers(['PENDING']);
    const { unmount } = render(<PlansSuccessPage />);
    await screen.findByRole('heading', { level: 1, name: t.waiting.title });

    unmount();
    const before = statusCalls();
    await act(() => vi.advanceTimersByTimeAsync(CHECKOUT_POLL_INTERVAL_MS * 5));

    expect(statusCalls()).toBe(before);
  });
});

describe('PlansSuccessPage confirmed (frame r2)', () => {
  it.each(['light', 'dark'] as const)(
    'confirms with the real plan and limit, reloads the account and links to the office plan (%s)',
    async (scheme) => {
      answers(['PENDING', 'CONFIRMED']);
      const { container } = render(<PlansSuccessPage />, { scheme });

      await act(() => vi.advanceTimersByTimeAsync(CHECKOUT_POLL_INTERVAL_MS));

      const heading = await screen.findByRole('heading', { level: 1, name: t.confirmed.title });
      expect(heading).toHaveFocus();
      expect(screen.getByText(/O plano Profissional do seu escritório está ativo/)).toBeVisible();
      expect(screen.getByText(/até 5 jornadas em andamento/)).toBeVisible();
      expect(screen.getByRole('link', { name: t.confirmed.action })).toHaveAttribute(
        'href',
        '/office/plan',
      );
      expect(env.refreshUser).toHaveBeenCalledTimes(1);
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('still confirms, without the details, when the plan cannot be read just now', async () => {
    answers(['CONFIRMED'], new ApiError('INTERNAL_ERROR', {}, 500));
    render(<PlansSuccessPage />);

    expect(await screen.findByRole('heading', { level: 1, name: t.confirmed.title })).toBeVisible();
    expect(screen.getByText(t.confirmed.descriptionNoPlan)).toBeVisible();
  });
});

describe('PlansSuccessPage slow (frame r4)', () => {
  it('stops insisting after the bounded wait and offers to check again, going back or support', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    answers(['PENDING']);
    const { container } = render(<PlansSuccessPage />);
    await screen.findByRole('heading', { level: 1, name: t.waiting.title });

    await act(() => vi.advanceTimersByTimeAsync(CHECKOUT_MAX_WAIT_MS + CHECKOUT_POLL_INTERVAL_MS));

    expect(await screen.findByRole('heading', { level: 1, name: t.slow.title })).toHaveFocus();
    expect(screen.getByRole('link', { name: t.slow.back })).toHaveAttribute('href', '/plans');
    expect(screen.getByRole('link', { name: t.slow.support })).toHaveAttribute('href', '/support');
    expect(await axe(container)).toHaveNoViolations();
    const calls = statusCalls();
    await act(() => vi.advanceTimersByTimeAsync(CHECKOUT_POLL_INTERVAL_MS * 4));
    expect(statusCalls()).toBe(calls);

    // asking again starts a new bounded wait, and a confirmation ends it
    answers(['CONFIRMED']);
    await user.click(screen.getByRole('button', { name: t.slow.retry }));
    expect(await screen.findByRole('heading', { level: 1, name: t.confirmed.title })).toBeVisible();
  });
});

describe('PlansSuccessPage failed (frame r5)', () => {
  it('shows the message of the error code and its code, and tries again on request', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    answers([new ApiError('INTERNAL_ERROR', {}, 500)]);
    const { container } = render(<PlansSuccessPage />);

    const heading = await screen.findByRole('heading', { level: 1, name: t.failed.title });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText(new RegExp(messages.errors.INTERNAL_ERROR))).toBeVisible();
    expect(screen.getByText('Código: INTERNAL_ERROR')).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();

    answers(['CONFIRMED']);
    await user.click(screen.getByRole('button', { name: t.failed.retry }));
    expect(await screen.findByRole('heading', { level: 1, name: t.confirmed.title })).toBeVisible();
  });

  it('a failure that is not an API error is reported as UNKNOWN', async () => {
    answers([new Error('network')]);
    render(<PlansSuccessPage />);

    expect(await screen.findByText('Código: UNKNOWN')).toBeVisible();
  });
});

describe('PlansSuccessPage without a checkout ref', () => {
  it('asks nothing and sends the visitor back to the plans', async () => {
    window.history.pushState({}, '', '/plans/success');
    render(<PlansSuccessPage />);

    expect(
      await screen.findByRole('heading', { level: 1, name: t.missingRef.title }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: t.missingRef.action })).toHaveAttribute(
      'href',
      '/plans',
    );
    expect(env.apiJson).not.toHaveBeenCalled();
  });
});
