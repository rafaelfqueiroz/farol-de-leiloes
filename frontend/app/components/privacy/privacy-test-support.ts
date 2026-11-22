// Fixtures of the privacy page's tests: the answers of the API (AR-36) for an account with a
// password, in the shape the BFF hands to the browser. Invented people and numbers, never real data.
import { CURRENT_LEGAL } from '@/test/legal-fixtures';
import type { Acceptance, DataExport, WhatsappConsent } from './privacy-api';

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// 2026-11-19T17:32:00Z is 14:32 in Brasília; 2026-11-02T12:10:00Z is 09:10
export const ACCEPTANCES: Acceptance[] = [
  {
    documentType: 'terms',
    version: '0.2',
    acceptedAt: '2026-11-19T17:32:00.000Z',
    method: 'reacceptance',
  },
  {
    documentType: 'privacy',
    version: '0.2',
    acceptedAt: '2026-11-19T17:32:00.000Z',
    method: 'reacceptance',
  },
  {
    documentType: 'terms',
    version: '0.1',
    acceptedAt: '2026-11-02T12:10:00.000Z',
    method: 'signup_email',
  },
  {
    documentType: 'privacy',
    version: '0.1',
    acceptedAt: '2026-11-02T12:10:00.000Z',
    method: 'signup_email',
  },
];

export const WHATSAPP_ON: WhatsappConsent = {
  state: 'granted',
  at: '2026-11-02T12:10:00.000Z',
  textVersion: '1',
};
export const WHATSAPP_OFF: WhatsappConsent = {
  state: 'withdrawn',
  at: '2026-11-18T20:45:00.000Z',
  textVersion: '1',
};

const items = (count: number) => Array.from({ length: count }, (_, index) => ({ n: index }));

export const MY_DATA = {
  schemaVersion: 1,
  generatedAt: '2026-11-20T12:00:00.000Z',
  account: {
    id: '64b7f0000000000000000b01',
    email: 'ana@exemplo.com.br',
    name: 'Ana Souza',
    phone: '+5511912345678',
    signIn: { methods: ['password', 'google'], googleId: 'google-1' },
  },
  favorites: { items: items(24) },
  savedFilters: { items: items(3) },
  reminders: { items: items(5) },
  notificationLogs: { items: items(18) },
};

export const QUEUED: DataExport = {
  id: '64b7f0000000000000000e01',
  status: 'queued',
  requestedAt: '2026-11-19T17:40:00.000Z',
};
export const READY: DataExport = {
  id: '64b7f0000000000000000e01',
  status: 'ready',
  requestedAt: '2026-11-19T17:40:00.000Z',
  readyAt: '2026-11-19T17:45:00.000Z',
  expiresAt: '2026-11-26T17:45:00.000Z',
};
export const FAILED: DataExport = {
  id: '64b7f0000000000000000e01',
  status: 'failed',
  requestedAt: '2026-11-19T17:40:00.000Z',
  errorCode: 'EXPORT_BUILD_FAILED',
};
export const EXPIRED: DataExport = { ...READY, status: 'expired' };

export interface PrivacyAnswers {
  acceptances?: unknown;
  whatsapp?: unknown;
  myData?: unknown;
  exports?: DataExport[];
  legal?: unknown;
}

/** A `fetch` that answers the privacy page's reads; a test overrides the rest by path. */
export function privacyFetch(
  answers: PrivacyAnswers = {},
  more: (url: string, init?: RequestInit) => Response | Promise<Response> | undefined = () =>
    undefined,
) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const extra = await more(url, init);
    if (extra) return extra;
    if (url === '/api/privacy/acceptances')
      return json({ items: answers.acceptances ?? ACCEPTANCES });
    if (url === '/api/privacy/whatsapp-consent' && (init?.method ?? 'GET') === 'GET') {
      return json(answers.whatsapp ?? WHATSAPP_ON);
    }
    if (url === '/api/privacy/my-data') return json(answers.myData ?? MY_DATA);
    if (url.startsWith('/api/privacy/exports?')) return json({ items: answers.exports ?? [] });
    if (url === '/api/legal/current') return json(answers.legal ?? CURRENT_LEGAL);
    return json({ code: 'NOT_FOUND', context: {} }, 404);
  };
}
