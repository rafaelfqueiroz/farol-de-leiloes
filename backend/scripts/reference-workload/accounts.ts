// SPEC-003 BR-003-08: the accounts every seeded reference workload carries, so E2E and the
// performance run can sign in. TEST VALUES ONLY: they exist in the throwaway databases this seed
// is allowed to write to (target.ts) and nowhere else. The `.test` domain is reserved and never
// delivers mail; the names are obviously fake (TS-27, SC-32).
//
// frontend/e2e/support/accounts.ts repeats these values for Playwright; change both together.

export interface SeedAccount {
  email: string;
  password: string;
  name: string;
  role: 'admin' | 'premium';
}

export const SEED_ACCOUNTS = {
  /** A verified investor on the top plan, so every signed-in screen renders its full content. */
  investor: {
    email: 'investidor.e2e@farol.test',
    password: 'Farol-E2E-investidor-2026',
    name: 'Investidora Teste E2E',
    role: 'premium',
  },
  /** A verified admin, for the admin screens (/admin/coupons). */
  admin: {
    email: 'admin.e2e@farol.test',
    password: 'Farol-E2E-admin-2026',
    name: 'Admin Teste E2E',
    role: 'admin',
  },
} as const satisfies Record<string, SeedAccount>;
