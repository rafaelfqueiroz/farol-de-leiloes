// Shared by the SPEC-012 page tests: the placeholder catalogue (Q-15) and the office plan, with
// obviously fake names and round numbers (TS-27), and a router for the BFF paths the pages call.
import { vi } from 'vitest';
import type { CatalogPlan, OfficeSubscription, PlansResponse } from './plans-api';

export const ESSENCIAL: CatalogPlan = {
  code: 'essencial',
  name: 'Essencial',
  price: '189.90',
  interval: 'month',
  activeJourneyLimit: 2,
};
export const PROFISSIONAL: CatalogPlan = {
  code: 'profissional',
  name: 'Profissional',
  price: '449.90',
  interval: 'month',
  activeJourneyLimit: 5,
};
export const AVANCADO: CatalogPlan = {
  code: 'avancado',
  name: 'Avançado',
  price: '12990.00',
  interval: 'year',
  activeJourneyLimit: 15,
};

export const CATALOGUE: PlansResponse = {
  items: [ESSENCIAL, PROFISSIONAL, AVANCADO],
  refundWindowDays: 7,
};

export const OFFICE_ID = '64b7f0000000000000000c01';

export function aSubscription(overrides: Partial<OfficeSubscription> = {}): OfficeSubscription {
  return {
    officeId: OFFICE_ID,
    plan: { code: 'profissional', name: 'Profissional', price: '449.90', interval: 'month' },
    status: 'ACTIVE',
    activeJourneyLimit: 5,
    inProgress: 4,
    currentPeriodStart: '2026-11-14T15:00:00.000Z',
    currentPeriodEnd: '2026-12-14T15:00:00.000Z',
    cancelAtPeriodEnd: false,
    scheduledChange: null,
    canUndoScheduledChange: false,
    canUndoCancel: false,
    nextChargeAmount: '449.90',
    lapsedAt: null,
    readOnlyAt: null,
    firstPaidAt: '2026-06-14T15:00:00.000Z',
    refundEligibleUntil: null,
    refundWindowDays: 7,
    graceDays: 10,
    ...overrides,
  };
}

/** A fake `apiJson`: a handler per `METHOD path`; an unknown call fails the test loudly. */
export type Handler = (init: { method?: string; json?: unknown }) => unknown;

export function routedApi(routes: Record<string, Handler>) {
  return vi.fn(async (path: string, init: { method?: string; json?: unknown } = {}) => {
    const key = `${init.method ?? 'GET'} ${path.split('?')[0]}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected API call: ${key}`);
    return handler(init);
  });
}
