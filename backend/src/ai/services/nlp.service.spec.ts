// The model's answer is untrusted input: NlpService keeps only the known search parameters, typed,
// with AR-35 paging (page/pageSize) instead of the retired limit/offset. The LLM is a stub that
// returns canned text; nothing leaves the process (TS-07).
import { describe, expect, it } from 'vitest';
import { NlpService } from './nlp.service';
import type { LlmAdapter } from '../adapters/llm.adapter';

function serviceAnswering(text: string): NlpService {
  const llm = { chat: async () => text } as unknown as LlmAdapter;
  return new NlpService(llm);
}

describe('NlpService.extractQueryParams', () => {
  it('normalises the state and modality and keeps page and pageSize', async () => {
    const service = serviceAnswering(
      '```json\n{"state": "rio grande do norte", "city": "Natal", "modality": "venda direta",' +
        ' "maxMargin": 300000, "page": 2, "pageSize": 50}\n```',
    );

    await expect(service.extractQueryParams('...')).resolves.toEqual({
      state: 'RN',
      city: 'Natal',
      modality: 'DIRECT_ONLINE_SALES',
      maxMargin: 300000,
      page: 2,
      pageSize: 50,
    });
  });

  it('caps pageSize at the 100 a page can hold (AR-35)', async () => {
    const service = serviceAnswering('{"pageSize": 250}');

    await expect(service.extractQueryParams('...')).resolves.toEqual({ pageSize: 100 });
  });

  it('drops the retired limit/offset, unknown keys and mistyped values', async () => {
    const service = serviceAnswering(
      '{"limit": 10, "offset": 20, "role": "admin", "page": 0, "pageSize": 2.5,' +
        ' "minMargin": "cheap", "maxMargin": -1, "city": "  ", "state": 7}',
    );

    await expect(service.extractQueryParams('...')).resolves.toEqual({});
  });

  it('answers no parameters when the model answers something that is not an object', async () => {
    await expect(serviceAnswering('[1, 2]').extractQueryParams('...')).resolves.toEqual({});
    await expect(serviceAnswering('not json').extractQueryParams('...')).resolves.toEqual({});
    await expect(serviceAnswering('').extractQueryParams('...')).resolves.toEqual({});
  });
});
