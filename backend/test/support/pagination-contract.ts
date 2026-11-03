// AR-35: the HTTP contract every paginated list endpoint shares, as one reusable block of specs.
// A controller spec calls itAnswersPages() with its app, path and the stubbed service method the
// controller pages through.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { expect, it, type Mock } from 'vitest';
import { type PageRequest, paginated } from '../../src/common/pagination/paginated';

export interface PaginatedEndpoint {
  app: () => INestApplication;
  /** e.g. '/api/favorites' */
  path: string;
  /** The stubbed service method behind the endpoint. */
  method: Mock;
  /** Position of the PageRequest among that method's arguments. */
  pageArg: number;
  /** What the service returns as the one item of the page. */
  item: unknown;
  /** That item as the response body shows it, mapped to its DTO and serialised. */
  expectedItem: unknown;
}

export function itAnswersPages(endpoint: PaginatedEndpoint): void {
  const { path, method, pageArg } = endpoint;
  const http = () => request(endpoint.app().getHttpServer());

  function servePage(total: number): void {
    method.mockImplementation(async (...args: unknown[]) =>
      paginated([endpoint.item], total, args[pageArg] as PageRequest),
    );
  }

  it('AR-35: defaults to page 1 of 20 and answers { items, total, page, pageSize }', async () => {
    servePage(1);

    const response = await http().get(path).expect(200);

    expect(response.body).toEqual({
      items: [endpoint.expectedItem],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    expect(method).toHaveBeenCalledTimes(1);
    expect(method.mock.calls[0]?.[pageArg]).toEqual({ page: 1, pageSize: 20 });
  });

  it('AR-35: hands the requested page to the service and echoes it with the full total', async () => {
    servePage(250);

    const response = await http().get(`${path}?page=3&pageSize=100`).expect(200);

    expect(response.body).toMatchObject({ total: 250, page: 3, pageSize: 100 });
    expect(method.mock.calls[0]?.[pageArg]).toEqual({ page: 3, pageSize: 100 });
  });

  it.each(['101', '0', '2.5', 'all'])(
    'AR-35: refuses pageSize=%s with VALIDATION_FAILED, never clamping it',
    async (pageSize) => {
      await http()
        .get(`${path}?pageSize=${pageSize}`)
        .expect(400, { code: 'VALIDATION_FAILED', context: { fields: ['pageSize'] } });

      expect(method).not.toHaveBeenCalled();
    },
  );

  it('AR-34: refuses an unknown query parameter', async () => {
    await http()
      .get(`${path}?limit=10`)
      .expect(400, { code: 'VALIDATION_FAILED', context: { fields: ['limit'] } });
  });
}
