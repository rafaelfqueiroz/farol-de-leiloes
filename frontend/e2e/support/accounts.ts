// The seeded test accounts and fixtures of the reference workload (SPEC-003 BR-003-08). These
// repeat backend/scripts/reference-workload/accounts.ts and catalog.ts (FIXTURE_AUCTIONS), which
// the stack's `seed` service writes; change both together. Test values only: they exist in the
// E2E stack's throwaway MongoDB and nowhere else (TS-27).

export interface E2eAccount {
  email: string;
  password: string;
}

export const ACCOUNTS = {
  investor: { email: 'investidor.e2e@farol.test', password: 'Farol-E2E-investidor-2026' },
  // Seeded with `isAdmin: true` (SPEC-002 DL-002-05), the capability the admin screens need. It
  // lives in the database only: these objects are the sign-in body, which takes nothing else.
  admin: { email: 'admin.e2e@farol.test', password: 'Farol-E2E-admin-2026' },
  /** Never confirmed its email: what /verify-email is for. */
  unverified: {
    email: 'nao-verificado.e2e@farol.test',
    password: 'Farol-E2E-nao-verificado-2026',
  },
} as const satisfies Record<string, E2eAccount>;

/** Published as "26/01/2026 - 10h00", Brasília time. */
export const BRASILIA_TEN_AM_AUCTION = '9000000000001';
