import { describe, expect, it } from 'vitest';
import type { AppConfigService } from '../../config/env.js';
import {
  auctionDocumentsThrottlerOptions,
  MATRICULA_LINK_RATE_LIMIT,
} from './auction-documents-throttler.module.js';

const config = (nodeEnv: string) => ({ get: () => nodeEnv }) as unknown as AppConfigService;

describe('the matrícula link throttler (SC-04)', () => {
  it('allows 20 links a minute per origin, and is switched off only in tests', () => {
    const production = auctionDocumentsThrottlerOptions(config('production'));
    const test = auctionDocumentsThrottlerOptions(config('test'));

    expect(MATRICULA_LINK_RATE_LIMIT).toEqual({ limit: 20, ttl: 60_000 });
    expect(production).toMatchObject({ throttlers: [{ limit: 20, ttl: 60_000 }] });
    expect((production as { skipIf: () => boolean }).skipIf()).toBe(false);
    expect((test as { skipIf: () => boolean }).skipIf()).toBe(true);
  });
});
