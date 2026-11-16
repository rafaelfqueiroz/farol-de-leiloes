import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { renderWithProviders as render } from '@/test/render';
import AdminCouponsPage from './page';

// SPEC-012: the administrator's coupon list. Only an admin may see it (everyone else is sent home),
// the list is paged (AR-35), and an invalidation or a creation reloads it. The discount and date
// formats and the creation payload are in page.test.tsx.
const env = vi.hoisted(() => {
  const push = vi.fn();
  return {
    push,
    // Next's router is a stable object; the page's effect depends on it
    router: { push },
    auth: { role: 'admin', loading: false } as { role: string; loading: boolean },
    report: vi.fn(),
  };
});
const fetchMock = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => env.router }));
vi.mock('@/app/contexts/AuthContext', () => ({ useAuth: () => env.auth }));
vi.mock('@/lib/report-client-error', () => ({ reportClientError: env.report }));

// TS-06: "now" is fixed, so which coupon has expired does not depend on the day the suite runs
const NOW = new Date('2026-06-15T15:00:00.000Z');

const coupon = (id: string, overrides: Record<string, unknown> = {}) => ({
  _id: id,
  code: `CUPOM${id}`,
  discountValue: '10.00',
  validTo: '2026-12-31T02:59:59.999Z',
  active: true,
  createdAt: '2026-01-01T03:00:00.000Z',
  ...overrides,
});

type Answer = { status: number; body?: unknown };
let listAnswer: (page: number) => Answer;
let mutationAnswer: Answer;

function calledWith(method: string) {
  return fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method);
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  env.push.mockReset();
  env.report.mockReset();
  env.auth = { role: 'admin', loading: false };
  listAnswer = () => ({
    status: 200,
    body: { items: [coupon('1')], total: 1, page: 1, pageSize: 20 },
  });
  mutationAnswer = { status: 200, body: {} };
  fetchMock.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    const isList = (init?.method ?? 'GET') === 'GET';
    const answer = isList
      ? listAnswer(Number(new URL(url, 'http://x').searchParams.get('page')))
      : mutationAnswer;
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AdminCouponsPage access', () => {
  it('sends anyone who is not an administrator home, showing and loading nothing', () => {
    env.auth = { role: 'premium', loading: false };
    const { container } = render(<AdminCouponsPage />);

    expect(env.push).toHaveBeenCalledWith('/');
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waits for the session before deciding, with a spinner', () => {
    env.auth = { role: 'free', loading: true };
    render(<AdminCouponsPage />);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(env.push).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('AdminCouponsPage list', () => {
  it('asks for the first page with the session cookie and no Authorization header', async () => {
    render(<AdminCouponsPage />);

    await screen.findByText('CUPOM1');

    expect(fetchMock).toHaveBeenCalledWith('/api/coupons?page=1&pageSize=20', {
      credentials: 'same-origin',
    });
  });

  it('tells an active coupon from an expired one and from an invalidated one', async () => {
    listAnswer = () => ({
      status: 200,
      body: {
        items: [
          coupon('1'),
          coupon('2', { validTo: '2026-06-14T02:59:59.999Z' }),
          coupon('3', { active: false }),
        ],
        total: 3,
        page: 1,
        pageSize: 20,
      },
    });
    render(<AdminCouponsPage />);
    await screen.findByText('CUPOM1');

    const row = (code: string) => screen.getByText(code).closest('tr') as HTMLElement;
    expect(within(row('CUPOM1')).getByText('Ativo')).toBeVisible();
    expect(within(row('CUPOM2')).getByText('Expirado')).toBeVisible();
    expect(within(row('CUPOM3')).getByText('Invalidado')).toBeVisible();
    // only an active coupon can still be invalidated
    expect(within(row('CUPOM1')).getByRole('button', { name: 'Invalidar' })).toBeVisible();
    expect(
      within(row('CUPOM2')).queryByRole('button', { name: 'Invalidar' }),
    ).not.toBeInTheDocument();
    expect(
      within(row('CUPOM3')).queryByRole('button', { name: 'Invalidar' }),
    ).not.toBeInTheDocument();
  });

  it('shows the description, or a dash when there is none', async () => {
    listAnswer = () => ({
      status: 200,
      body: {
        items: [coupon('1', { description: 'Campanha de verão' }), coupon('2')],
        total: 2,
        page: 1,
        pageSize: 20,
      },
    });
    render(<AdminCouponsPage />);

    expect(await screen.findByText('Campanha de verão')).toBeVisible();
    expect(screen.getByText('-')).toBeVisible();
  });

  it('says so when there are no coupons', async () => {
    listAnswer = () => ({ status: 200, body: { items: [], total: 0, page: 1, pageSize: 20 } });
    render(<AdminCouponsPage />);

    expect(await screen.findByText('Nenhum cupom cadastrado')).toBeVisible();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('reports the failure, and shows the empty list, when the API refuses', async () => {
    listAnswer = () => ({ status: 500, body: { code: 'INTERNAL_ERROR', context: {} } });
    render(<AdminCouponsPage />);

    expect(await screen.findByText('Nenhum cupom cadastrado')).toBeVisible();
    expect(env.report).toHaveBeenCalledWith(expect.objectContaining({ code: 'INTERNAL_ERROR' }), {
      where: 'admin/coupons page',
    });
  });
});

describe('AdminCouponsPage paging', () => {
  beforeEach(() => {
    listAnswer = (page) => ({
      status: 200,
      body: { items: [coupon(`p${page}`)], total: 45, page, pageSize: 20 },
    });
  });

  it('shows 3 pages for 45 coupons and loads the one picked', async () => {
    const user = userEvent.setup();
    render(<AdminCouponsPage />);
    await screen.findByText('CUPOMp1');
    const pager = screen.getByRole('navigation');
    expect(within(pager).getAllByRole('button', { name: /^(Go to )?page \d/i })).toHaveLength(3);

    await user.click(within(pager).getByRole('button', { name: /page 2/i }));

    expect(await screen.findByText('CUPOMp2')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith('/api/coupons?page=2&pageSize=20', expect.anything());
  });

  it('steps back to the last page that exists when the one asked for came back empty', async () => {
    const user = userEvent.setup();
    listAnswer = (page) =>
      page === 3
        ? { status: 200, body: { items: [], total: 40, page: 3, pageSize: 20 } }
        : { status: 200, body: { items: [coupon(`p${page}`)], total: 41, page, pageSize: 20 } };
    render(<AdminCouponsPage />);
    await screen.findByText('CUPOMp1');

    await user.click(
      within(screen.getByRole('navigation')).getByRole('button', { name: /page 3/i }),
    );

    // The list showed 41 coupons (3 pages) when page 3 was picked; by then it shrank to 40, so
    // page 3 is empty and the last page that exists is 2. A fallback that does not change the page
    // would leave page 1 on screen and never ask for page 2 (TS-25).
    expect(await screen.findByText('CUPOMp2')).toBeVisible();
    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls).toEqual([
      '/api/coupons?page=1&pageSize=20',
      '/api/coupons?page=3&pageSize=20',
      '/api/coupons?page=2&pageSize=20',
    ]);
  });
});

describe('AdminCouponsPage invalidate', () => {
  it('invalidates the coupon, confirms and reloads the list', async () => {
    const user = userEvent.setup();
    render(<AdminCouponsPage />);
    await screen.findByText('CUPOM1');

    await user.click(screen.getByRole('button', { name: 'Invalidar' }));

    expect(await screen.findByText(messages.adminCoupons.snackbar.invalidated)).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith('/api/coupons/1/invalidate', {
      method: 'PATCH',
      credentials: 'same-origin',
    });
    await waitFor(() => expect(calledWith('GET')).toHaveLength(2));
  });

  it('shows the catalogue message of the code when it is refused', async () => {
    mutationAnswer = { status: 404, body: { code: 'COUPON_NOT_FOUND', context: {} } };
    const user = userEvent.setup();
    render(<AdminCouponsPage />);
    await screen.findByText('CUPOM1');

    await user.click(screen.getByRole('button', { name: 'Invalidar' }));

    expect(await screen.findByText(messages.errors.COUPON_NOT_FOUND)).toBeVisible();
    expect(calledWith('GET')).toHaveLength(1);
  });
});

describe('AdminCouponsPage create dialog', () => {
  async function openDialog() {
    const user = userEvent.setup();
    render(<AdminCouponsPage />);
    await screen.findByText('CUPOM1');
    await user.click(screen.getByRole('button', { name: /Novo Cupom/ }));
    return { user, dialog: await screen.findByRole('dialog') };
  }

  it('keeps Create disabled until the code, discount and date are filled', async () => {
    const { user, dialog } = await openDialog();
    const create = within(dialog).getByRole('button', { name: 'Criar Cupom' });
    expect(create).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/Código do cupom/), 'abc');
    await user.type(within(dialog).getByLabelText(/Valor do desconto/), '5');
    expect(create).toBeDisabled();
    await user.click(within(dialog).getByRole('spinbutton', { name: 'Dia' }));
    await user.keyboard('31122099');

    expect(create).toBeEnabled();
    // the code is upper-cased as it is typed
    expect(within(dialog).getByLabelText(/Código do cupom/)).toHaveValue('ABC');
  });

  it('closes on Cancel without creating anything', async () => {
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calledWith('POST')).toHaveLength(0);
  });

  it('creates the coupon, confirms, closes the dialog and reloads the list', async () => {
    mutationAnswer = { status: 201, body: {} };
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByLabelText(/Código do cupom/), 'abc');
    await user.type(within(dialog).getByLabelText(/Valor do desconto/), '5');
    await user.type(within(dialog).getByLabelText(/Descrição/), 'Campanha');
    await user.click(within(dialog).getByRole('spinbutton', { name: 'Dia' }));
    await user.keyboard('31122099');

    await user.click(within(dialog).getByRole('button', { name: 'Criar Cupom' }));

    expect(await screen.findByText(messages.adminCoupons.snackbar.created)).toBeVisible();
    expect(JSON.parse(calledWith('POST')[0]?.[1].body)).toEqual({
      code: 'ABC',
      discountValue: '5.00',
      validTo: '2099-12-31',
      description: 'Campanha',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(calledWith('GET')).toHaveLength(2));
  });

  it('shows the catalogue message of the code, and keeps the dialog, when creation is refused', async () => {
    mutationAnswer = { status: 400, body: { code: 'VALIDATION_FAILED', context: {} } };
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByLabelText(/Código do cupom/), 'abc');
    await user.type(within(dialog).getByLabelText(/Valor do desconto/), '5');
    await user.click(within(dialog).getByRole('spinbutton', { name: 'Dia' }));
    await user.keyboard('31122099');

    await user.click(within(dialog).getByRole('button', { name: 'Criar Cupom' }));

    expect(await screen.findByText(messages.errors.VALIDATION_FAILED)).toBeVisible();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Código do cupom/)).toHaveValue('ABC');
  });
});
