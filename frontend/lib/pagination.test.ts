import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-error';
import { fetchAllPages, pageCount } from './pagination';

const fetchMock = vi.fn();

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const page = (items: number[], total: number) =>
  new Response(JSON.stringify({ items, total, page: 1, pageSize: 100 }), { status: 200 });

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
    fetchMock.mockResolvedValueOnce(page([1, 2], 3)).mockResolvedValueOnce(page([3], 3));

    const items = await fetchAllPages<number>('/api/x', { headers: { Authorization: 'Bearer t' } });

    expect(items).toEqual([1, 2, 3]);
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

  it('stops when the caller no longer wants the answer', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(page([1], 500));

    await fetchAllPages<number>('/api/x', {}, () => false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never walks more than 20 pages', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async () => page([1], 1_000_000));

    await fetchAllPages<number>('/api/x', {});

    expect(fetchMock).toHaveBeenCalledTimes(20);
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
