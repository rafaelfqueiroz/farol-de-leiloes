import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-error';
import { fetchAllPages, PaginationCancelledError, pageCount } from './pagination';

const fetchMock = vi.fn();

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const page = (items: number[], total: number) =>
  new Response(JSON.stringify({ items, total, page: 1, pageSize: 100 }), { status: 200 });

const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);

describe('pageCount', () => {
  it('rounds up, and is never below one page', () => {
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(20, 20)).toBe(1);
    expect(pageCount(21, 20)).toBe(2);
    expect(pageCount(45, 20)).toBe(3);
  });
});

describe('fetchAllPages', () => {
  it('walks the pages 100 at a time until it has them all (AR-35)', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(page(range(0, 100), 101))
      .mockResolvedValueOnce(page([100], 101));

    const items = await fetchAllPages<number>('/api/x', { headers: { Authorization: 'Bearer t' } });

    expect(items).toEqual(range(0, 101));
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/x?page=1&pageSize=100',
      '/api/x?page=2&pageSize=100',
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({ headers: { Authorization: 'Bearer t' } });
  });

  it('appends to a path that already has a query', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(page([], 0));

    await fetchAllPages<number>('/api/x?kind=a', {});

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/x?kind=a&page=1&pageSize=100');
  });

  it('stops on an empty page even if the total promised more', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(page([1], 5)).mockResolvedValueOnce(page([], 5));

    expect(await fetchAllPages<number>('/api/x', {})).toEqual([1]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reads more than 20 pages so a long list is never truncated (AR-35)', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const total = 2_050;
    fetchMock.mockImplementation(async (url: string) => {
      const pageNumber = Number(new URL(url, 'http://x').searchParams.get('page'));
      return page(
        range((pageNumber - 1) * 100, Math.min(100, total - (pageNumber - 1) * 100)),
        total,
      );
    });

    const items = await fetchAllPages<number>('/api/x', {});

    expect(fetchMock).toHaveBeenCalledTimes(21);
    expect(items).toEqual(range(0, total));
  });

  it('stops without an extra request once it holds the total', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(page(range(0, 100), 200))
      .mockResolvedValueOnce(page(range(100, 100), 200));

    expect(await fetchAllPages<number>('/api/x', {})).toHaveLength(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps reading after a short page below the total until an empty one', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(page([1, 2], 5))
      .mockResolvedValueOnce(page([3], 5))
      .mockResolvedValueOnce(page([], 5));

    expect(await fetchAllPages<number>('/api/x', {})).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects, never resolves with part of the list, when the caller no longer wants it', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(page([1], 500));

    await expect(fetchAllPages<number>('/api/x', {}, () => false)).rejects.toBeInstanceOf(
      PaginationCancelledError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects when the caller stops wanting it between pages', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async () => page(range(0, 100), 500));
    let calls = 0;

    await expect(fetchAllPages<number>('/api/x', {}, () => ++calls < 2)).rejects.toBeInstanceOf(
      PaginationCancelledError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects with the ApiError when a later page fails, not with the pages read so far', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(page(range(0, 100), 250))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'INTERNAL_ERROR' }), { status: 500 }),
      );

    await expect(fetchAllPages<number>('/api/x', {})).rejects.toMatchObject({
      constructor: ApiError,
      status: 500,
    });
  });

  it('throws the ApiError of a page that fails', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'VALIDATION_FAILED', context: { fields: ['pageSize'] } }),
        {
          status: 400,
        },
      ),
    );

    await expect(fetchAllPages<number>('/api/x', {})).rejects.toMatchObject({
      constructor: ApiError,
      code: 'VALIDATION_FAILED',
      status: 400,
    });
  });
});
