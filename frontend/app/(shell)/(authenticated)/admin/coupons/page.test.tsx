import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders as render } from '@/test/render';
import AdminCouponsPage from './page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/app/contexts/AuthContext', () => ({
  useAuth: () => ({ role: 'free', isAdmin: true, loading: false }),
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
    await userEvent.type(screen.getByLabelText(/Código do cupom/), 'ABC');
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
    await userEvent.type(screen.getByLabelText(/Código do cupom/), 'ABC');
    await userEvent.type(screen.getByLabelText(/Valor do desconto/), '10.555');
    await userEvent.click(screen.getByRole('spinbutton', { name: 'Dia' }));
    await userEvent.keyboard('31122099');
    await userEvent.click(screen.getByRole('button', { name: 'Criar Cupom' }));

    expect(await screen.findByText(/até duas casas decimais/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
});

describe('AdminCouponsPage structure (DS-15)', () => {
  it('has one h1 with the new-coupon action beside it, and no <main> of its own', async () => {
    render(<AdminCouponsPage />);
    await screen.findByText('R$ 10,00');

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Gerenciar Cupons' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Novo Cupom/ })).toBeVisible();
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
  });

  it('keeps the h1 while the list loads', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    render(<AdminCouponsPage />);

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Novo Cupom/ })).not.toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    // the AppShell owns <main> (#42), so the landmark is supplied here
    const { baseElement } = render(
      <main>
        <AdminCouponsPage />
      </main>,
    );
    await screen.findByText('R$ 10,00');
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
