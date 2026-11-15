import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { renderWithProviders as render } from '@/test/render';
import PlansPage from './page';

// SPEC-012: choosing, paying for and cancelling the Standard plan. The plan prices and copy are in
// page.test.tsx. Stripe is behind the backend (the BFF answers with a checkout URL), so the browser
// only ever navigates to the URL it is given (TS-07).
const env = vi.hoisted(() => ({ auth: {} as Record<string, unknown> }));
const fetchMock = vi.fn();
const assign = vi.fn();
const reload = vi.fn();

vi.mock('@/app/contexts/AuthContext', () => ({ useAuth: () => env.auth }));

beforeEach(() => {
  env.auth = { role: 'free', hasSubscription: false };
  window.localStorage.setItem('token', 'jwt-1');
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('location', { assign, reload });
});

afterEach(() => {
  fetchMock.mockReset();
  assign.mockReset();
  reload.mockReset();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

const answer = (status: number, body: unknown = {}) =>
  fetchMock.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body });

const jsonBodyOf = (call: number) =>
  JSON.parse((fetchMock.mock.calls[call]?.[1] as RequestInit).body as string);

describe('PlansPage coupon', () => {
  it('uppercases what is typed and keeps Apply disabled until there is a code', async () => {
    const user = userEvent.setup();
    render(<PlansPage />);
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeDisabled();

    await user.type(screen.getByPlaceholderText('Cupom de desconto'), 'verao10');

    expect(screen.getByPlaceholderText('Cupom de desconto')).toHaveValue('VERAO10');
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeEnabled();
  });

  it('validates the code with the token and shows the discount', async () => {
    answer(200, { discountValue: '10.00' });
    const user = userEvent.setup();
    render(<PlansPage />);

    await user.type(screen.getByPlaceholderText('Cupom de desconto'), 'verao10');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(await screen.findByText(/^Cupom aplicado! Desconto de/)).toHaveTextContent(
      /Desconto de R\$\s10,00/,
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/coupons/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-1' },
      body: JSON.stringify({ code: 'VERAO10' }),
    });
  });

  it('shows the catalogue message of the code when the coupon is refused', async () => {
    answer(400, { code: 'COUPON_INVALID', context: {} });
    const user = userEvent.setup();
    render(<PlansPage />);

    await user.type(screen.getByPlaceholderText('Cupom de desconto'), 'velho');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.COUPON_INVALID);
    expect(screen.queryByText(/^Cupom aplicado!/)).not.toBeInTheDocument();
  });

  it('forgets a validated coupon when the code is edited', async () => {
    answer(200, { discountValue: '10.00' });
    const user = userEvent.setup();
    render(<PlansPage />);
    await user.type(screen.getByPlaceholderText('Cupom de desconto'), 'a');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    await screen.findByText(/^Cupom aplicado!/);

    await user.type(screen.getByPlaceholderText('Cupom de desconto'), 'b');

    expect(screen.queryByText(/^Cupom aplicado!/)).not.toBeInTheDocument();
  });

  it('is not offered to the subscriber of the Standard plan', () => {
    env.auth = { role: 'standard', hasSubscription: true };
    render(<PlansPage />);

    expect(screen.queryByPlaceholderText('Cupom de desconto')).not.toBeInTheDocument();
  });
});

describe('PlansPage subscribing', () => {
  it('opens the checkout the API created', async () => {
    answer(200, { url: 'https://checkout.stripe.test/session-1' });
    const user = userEvent.setup();
    render(<PlansPage />);

    await user.click(screen.getByRole('button', { name: 'Assinar Standard' }));

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/session-1'),
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/payments/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-1' },
      body: JSON.stringify({ planId: 'standard' }),
    });
  });

  it('sends a validated coupon along with the plan', async () => {
    answer(200, { discountValue: '10.00' });
    answer(200, { url: 'https://checkout.stripe.test/session-2' });
    const user = userEvent.setup();
    render(<PlansPage />);
    await user.type(screen.getByPlaceholderText('Cupom de desconto'), 'verao10');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    await screen.findByText(/^Cupom aplicado!/);

    await user.click(screen.getByRole('button', { name: 'Assinar Standard' }));

    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(jsonBodyOf(1)).toEqual({ planId: 'standard', couponCode: 'VERAO10' });
  });

  it('does not send a coupon that was typed but never validated', async () => {
    answer(200, { url: 'https://checkout.stripe.test/session-3' });
    const user = userEvent.setup();
    render(<PlansPage />);
    await user.type(screen.getByPlaceholderText('Cupom de desconto'), 'verao10');

    await user.click(screen.getByRole('button', { name: 'Assinar Standard' }));

    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(jsonBodyOf(0)).toEqual({ planId: 'standard' });
  });

  it('shows the catalogue message of the code when the checkout cannot start', async () => {
    answer(502, { code: 'CHECKOUT_SESSION_FAILED', context: {} });
    const user = userEvent.setup();
    render(<PlansPage />);

    await user.click(screen.getByRole('button', { name: 'Assinar Standard' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      messages.errors.CHECKOUT_SESSION_FAILED,
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it('offers no purchase of the free plan and none of the premium plan', () => {
    env.auth = { role: 'standard', hasSubscription: true };
    render(<PlansPage />);

    expect(screen.getByRole('button', { name: 'Gratuito' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Em breve' })).toBeDisabled();
  });
});

describe('PlansPage current plan', () => {
  it('marks the free plan as the current one for a free account', () => {
    render(<PlansPage />);

    expect(screen.getByRole('button', { name: 'Plano Atual' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Cancelar assinatura' })).not.toBeInTheDocument();
  });

  it('marks Standard as the current plan of a subscriber, with a way to cancel', () => {
    env.auth = { role: 'standard', hasSubscription: true };
    render(<PlansPage />);

    expect(screen.getByRole('button', { name: 'Plano Atual' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar assinatura' })).toBeEnabled();
  });

  it('treats a Standard role without a subscription as the free plan', () => {
    env.auth = { role: 'standard', hasSubscription: false };
    render(<PlansPage />);

    expect(screen.getByRole('button', { name: 'Assinar Standard' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Cancelar assinatura' })).not.toBeInTheDocument();
  });

  it('marks the premium plan as the current one for a premium account', () => {
    env.auth = { role: 'premium', hasSubscription: true };
    render(<PlansPage />);

    expect(screen.getByRole('button', { name: 'Plano Atual' })).toBeDisabled();
  });
});

describe('PlansPage cancelling', () => {
  beforeEach(() => {
    env.auth = { role: 'standard', hasSubscription: true };
  });

  async function openDialog() {
    const user = userEvent.setup();
    render(<PlansPage />);
    await user.click(screen.getByRole('button', { name: 'Cancelar assinatura' }));
    return { user, dialog: await screen.findByRole('dialog') };
  }

  it('asks for confirmation and leaves the subscription alone when the user goes back', async () => {
    const { user, dialog } = await openDialog();
    expect(within(dialog).getByText(messages.plans.cancelDialog.body)).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Voltar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancels with the token, confirms and reloads the account', async () => {
    answer(200);
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole('button', { name: 'Confirmar cancelamento' }));

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/payments/cancel-subscription', {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-1' },
    });
    expect(await screen.findByText(messages.plans.cancelSuccess)).toBeVisible();
  });

  it('shows the catalogue message of the code and keeps the dialog when cancelling fails', async () => {
    answer(404, { code: 'SUBSCRIPTION_NOT_FOUND', context: {} });
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole('button', { name: 'Confirmar cancelamento' }));

    expect(await screen.findByText(messages.errors.SUBSCRIPTION_NOT_FOUND)).toBeVisible();
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
