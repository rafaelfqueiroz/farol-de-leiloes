import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-error';
import { RemindersProvider, useReminders } from './RemindersContext';
import { SavedFiltersProvider, useSavedFilters } from './SavedFiltersContext';

// AR-35: the reminders and saved filters are read page by page (100 per request), and AR-38/AR-39:
// a failed mutation rejects with the ApiError of the answer so the caller can show its message.
const env = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: env.push }) }));
vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: null, loading: true }) }));
vi.mock('@/lib/report-client-error', () => ({ reportClientError: vi.fn() }));

type Answer = { status: number; body: unknown };
let answers: Array<(url: string, init?: RequestInit) => Answer>;
let requests: Array<{ url: string; method: string }>;

beforeEach(() => {
  answers = [];
  requests = [];
  env.push.mockReset();
  window.localStorage.setItem('token', 'token-a');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method ?? 'GET' });
      const answer = answers.shift()?.(url, init);
      if (!answer) throw new Error(`unexpected request ${url}`);
      return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const page = (items: unknown[], total: number, pageNumber: number) => ({
  status: 200,
  body: { items, total, page: pageNumber, pageSize: 100 },
});

function RemindersProbe({ children }: { children?: ReactNode }) {
  const { reminders, loading } = useReminders();
  return (
    <>
      <p>{loading ? 'carregando' : `lembretes ${reminders.length}`}</p>
      {children}
    </>
  );
}

describe('RemindersProvider', () => {
  const items = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({ _id: `r${from + i}`, status: 'PENDING' }));

  it('reads every page of the list, 100 at a time', async () => {
    answers = [() => page(items(0, 100), 130, 1), () => page(items(100, 30), 130, 2)];
    render(
      <RemindersProvider>
        <RemindersProbe />
      </RemindersProvider>,
    );

    await waitFor(() => expect(screen.getByText('lembretes 130')).toBeInTheDocument());
    expect(requests.map((request) => request.url)).toEqual([
      '/api/reminders?page=1&pageSize=100',
      '/api/reminders?page=2&pageSize=100',
    ]);
  });

  it('stops after a page that is the last one', async () => {
    answers = [() => page(items(0, 3), 3, 1)];
    render(
      <RemindersProvider>
        <RemindersProbe />
      </RemindersProvider>,
    );

    await waitFor(() => expect(screen.getByText('lembretes 3')).toBeInTheDocument());
    expect(requests).toHaveLength(1);
  });

  it('shows no reminders when the API answers with an error', async () => {
    answers = [() => ({ status: 500, body: { code: 'INTERNAL_ERROR', context: {} } })];
    render(
      <RemindersProvider>
        <RemindersProbe />
      </RemindersProvider>,
    );

    await waitFor(() => expect(screen.getByText('lembretes 0')).toBeInTheDocument());
  });

  function Create({ onError }: { onError: (error: unknown) => void }) {
    const { createReminder } = useReminders();
    return (
      <button
        type="button"
        onClick={() =>
          createReminder({
            auctionId: 'a',
            channel: 'SMS',
            scheduledAt: '2026-11-14T13:00:00Z',
          }).catch(onError)
        }
      >
        Criar
      </button>
    );
  }

  it('rejects a failed creation with the ApiError of the answer (AR-38)', async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    answers = [
      () => page([], 0, 1),
      () => ({ status: 422, body: { code: 'PHONE_REQUIRED', context: { channel: 'sms' } } }),
    ];
    render(
      <RemindersProvider>
        <RemindersProbe>
          <Create onError={onError} />
        </RemindersProbe>
      </RemindersProvider>,
    );
    await waitFor(() => expect(screen.getByText('lembretes 0')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Criar' }));

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    const error = onError.mock.calls[0]?.[0] as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'PHONE_REQUIRED',
      context: { channel: 'sms' },
      status: 422,
    });
  });

  it('sends a 401 on a mutation to /login without rejecting', async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    answers = [() => page([], 0, 1), () => ({ status: 401, body: { code: 'UNAUTHENTICATED' } })];
    render(
      <RemindersProvider>
        <RemindersProbe>
          <Create onError={onError} />
        </RemindersProbe>
      </RemindersProvider>,
    );
    await waitFor(() => expect(screen.getByText('lembretes 0')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Criar' }));

    await waitFor(() => expect(env.push).toHaveBeenCalledWith('/login'));
    expect(onError).not.toHaveBeenCalled();
  });
});

function SavedFiltersProbe() {
  const { savedFilters, loading, saveFilter } = useSavedFilters();
  const [message, setMessage] = useState('');
  return (
    <>
      <p>{loading ? 'carregando' : `filtros ${savedFilters.length}`}</p>
      <p>{message}</p>
      <button
        type="button"
        onClick={() =>
          saveFilter('SP', {}).catch((error: unknown) =>
            setMessage(error instanceof ApiError ? `${error.code} ${error.context.limit}` : '?'),
          )
        }
      >
        Salvar
      </button>
    </>
  );
}

describe('SavedFiltersProvider', () => {
  it('reads the saved filters from the paginated list', async () => {
    answers = [() => page([{ _id: 'f1' }, { _id: 'f2' }], 2, 1)];
    render(
      <SavedFiltersProvider>
        <SavedFiltersProbe />
      </SavedFiltersProvider>,
    );

    await waitFor(() => expect(screen.getByText('filtros 2')).toBeInTheDocument());
    expect(requests[0]?.url).toBe('/api/saved-filters?page=1&pageSize=100');
  });

  it('rejects a save over the limit with the code and its context (AR-39)', async () => {
    const user = userEvent.setup();
    answers = [
      () => page([], 0, 1),
      () => ({
        status: 409,
        body: { code: 'SAVED_FILTER_LIMIT_REACHED', context: { limit: 5 } },
      }),
    ];
    render(
      <SavedFiltersProvider>
        <SavedFiltersProbe />
      </SavedFiltersProvider>,
    );
    await waitFor(() => expect(screen.getByText('filtros 0')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('SAVED_FILTER_LIMIT_REACHED 5')).toBeInTheDocument();
  });

  it('clears the filters on a 401', async () => {
    answers = [() => ({ status: 401, body: { code: 'UNAUTHENTICATED', context: {} } })];
    render(
      <SavedFiltersProvider>
        <SavedFiltersProbe />
      </SavedFiltersProvider>,
    );

    await waitFor(() => expect(screen.getByText('filtros 0')).toBeInTheDocument());
  });
});
