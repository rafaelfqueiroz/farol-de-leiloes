import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders as render } from '@/test/render';
import AdminCouponsPage from './page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/app/contexts/AuthContext', () => ({
  useAuth: () => ({ role: 'admin', loading: false }),
}));
vi.mock('@/lib/report-client-error', () => ({ reportClientError: vi.fn() }));

const coupon = {
  _id: 'c1',
  code: 'DEZ',
  discountValue: '10.00',
  validTo: '2027-01-01T02:59:59.999Z', // the end of 31 December in Brasília (#83)
  active: true,
  createdAt: '2026-01-01T03:00:00.000Z',
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return { ok: true, status: 201, json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ items: [coupon], total: 1, page: 1, pageSize: 20 }),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
});

// AR-17: the coupon discount is a reais string both ways; there is no centavos conversion.
describe('AdminCouponsPage coupon discount', () => {
  it('shows the discount string and the Brasília date', async () => {
    render(<AdminCouponsPage />);

    expect(await screen.findByText('R$ 10,00')).toBeInTheDocument();
    expect(screen.getByText('31/12/2026')).toBeInTheDocument();
  });

  it('creates a coupon with the discount as a reais string and the day as YYYY-MM-DD', async () => {
    render(<AdminCouponsPage />);
    await screen.findByText('R$ 10,00');

    await userEvent.click(screen.getByRole('button', { name: /Novo Cupom/ }));
    await userEvent.type(screen.getByLabelText(/Codigo do cupom/), 'ABC');
    await userEvent.type(screen.getByLabelText(/Valor do desconto/), '12.5');
    await userEvent.click(screen.getByRole('spinbutton', { name: 'Dia' }));
    await userEvent.keyboard('31122099');
    await userEvent.click(screen.getByRole('button', { name: 'Criar Cupom' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post).toBeDefined();
      expect(JSON.parse(post?.[1].body)).toMatchObject({
        code: 'ABC',
        discountValue: '12.50',
        validTo: '2099-12-31',
      });
    });
  });

  it('refuses a discount with more than two decimals instead of rounding it', async () => {
    render(<AdminCouponsPage />);
    await screen.findByText('R$ 10,00');

    await userEvent.click(screen.getByRole('button', { name: /Novo Cupom/ }));
    await userEvent.type(screen.getByLabelText(/Codigo do cupom/), 'ABC');
    await userEvent.type(screen.getByLabelText(/Valor do desconto/), '10.555');
    await userEvent.click(screen.getByRole('spinbutton', { name: 'Dia' }));
    await userEvent.keyboard('31122099');
    await userEvent.click(screen.getByRole('button', { name: 'Criar Cupom' }));

    expect(await screen.findByText(/até duas casas decimais/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
});
