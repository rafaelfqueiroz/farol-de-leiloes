// The model's answer is untrusted input: NlpService keeps only the known search parameters, typed,
// with AR-35 paging (page/pageSize) instead of the retired limit/offset. The LLM is a stub that
// returns canned text; nothing leaves the process (TS-07).
import { describe, expect, it } from 'vitest';
import { NlpService } from './nlp.service.js';
import type { LlmAdapter } from '../adapters/llm.adapter.js';
import { Decimal } from '../../common/money/money.js';

function serviceAnswering(text: string): NlpService {
  const llm = { chat: async () => text } as unknown as LlmAdapter;
  return new NlpService(llm);
}

describe('NlpService.extractQueryParams', () => {
  it('normalises the state and modality and keeps page and pageSize', async () => {
    const service = serviceAnswering(
      '```json\n{"state": "rio grande do norte", "city": "Natal", "modality": "venda direta",' +
        ' "maxPrice": 300000, "page": 2, "pageSize": 50}\n```',
    );

    await expect(service.extractQueryParams('...')).resolves.toEqual({
      state: 'RN',
      city: 'Natal',
      modality: 'DIRECT_ONLINE_SALES',
      maxPrice: new Decimal('300000'), // AR-17: a price leaves the model's JSON as a Decimal
      page: 2,
      pageSize: 50,
    });
  });

  it('AR-17: reads a price given as a number or a money string, and drops what is not one', async () => {
    const service = serviceAnswering('{"minPrice": "200000.50", "maxPrice": 400000.25}');

    await expect(service.extractQueryParams('...')).resolves.toEqual({
      minPrice: new Decimal('200000.50'),
      maxPrice: new Decimal('400000.25'),
    });

    // A third decimal, an exponent and a pt-BR string are not amounts GET /api/auctions takes.
    const dropped = serviceAnswering('{"minPrice": 1.005, "maxPrice": 1e21}');
    await expect(dropped.extractQueryParams('...')).resolves.toEqual({});
    const ptBr = serviceAnswering('{"maxPrice": "300.000,00"}');
    await expect(ptBr.extractQueryParams('...')).resolves.toEqual({});
  });

  it('caps pageSize at the 100 a page can hold (AR-35)', async () => {
    const service = serviceAnswering('{"pageSize": 250}');

    await expect(service.extractQueryParams('...')).resolves.toEqual({ pageSize: 100 });
  });

  it('drops the retired limit/offset, unknown keys and mistyped values', async () => {
    const service = serviceAnswering(
      '{"limit": 10, "offset": 20, "role": "admin", "page": 0, "pageSize": 2.5,' +
        ' "minPrice": "cheap", "maxPrice": -1, "city": "  ", "state": 7}',
    );

    await expect(service.extractQueryParams('...')).resolves.toEqual({});
  });

  it('answers no parameters when the model answers something that is not an object', async () => {
    await expect(serviceAnswering('[1, 2]').extractQueryParams('...')).resolves.toEqual({});
    await expect(serviceAnswering('not json').extractQueryParams('...')).resolves.toEqual({});
    await expect(serviceAnswering('').extractQueryParams('...')).resolves.toEqual({});
  });
});
