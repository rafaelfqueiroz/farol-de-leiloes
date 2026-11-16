// The seeded test accounts the performance run signs in with. They repeat
// frontend/e2e/support/accounts.ts and backend/scripts/reference-workload/accounts.ts, which the
// stack's `seed` service writes; perf/budgets.test.ts fails when this copy drifts from the E2E
// one. Test values only: they exist in the E2E stack's throwaway MongoDB and nowhere else (TS-27).
'use strict';

const ACCOUNTS = Object.freeze({
  investor: Object.freeze({
    email: 'investidor.e2e@farol.test',
    password: 'Farol-E2E-investidor-2026',
  }),
  admin: Object.freeze({ email: 'admin.e2e@farol.test', password: 'Farol-E2E-admin-2026' }),
});

module.exports = { ACCOUNTS };
