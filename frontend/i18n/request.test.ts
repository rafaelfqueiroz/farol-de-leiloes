// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import request from './request';

// next-intl/server refuses to load outside a React Server Components build. The framework call is
// stubbed to hand back the config callback itself; what is tested is that callback.
vi.mock('next-intl/server', () => ({ getRequestConfig: (config: unknown) => config }));

// DS-20, AR-23: one locale and one display zone, whatever the request carries.
describe('i18n request config', () => {
  it('serves the pt-BR catalogue in the Brasília zone, whatever locale was asked for', async () => {
    const config = await request({
      requestLocale: Promise.resolve('en-US'),
      locale: 'en-US',
    } as never);

    expect(config).toEqual({ locale: 'pt-BR', timeZone: 'America/Sao_Paulo', messages });
  });
});
