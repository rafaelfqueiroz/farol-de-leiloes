// SPEC-012 BR-012-02: the plan catalog every seeded reference workload carries, so the public
// plans page renders its cards (and axe checks their real contrast) in the E2E stack. TEST VALUES
// ONLY: placeholder names, prices and limits (Q-15 is open), and price ids that exist at no
// provider: the stack's gateway is the fake (TS-22). Operators maintain the real catalog with
// `npm run plans:upsert`; this never runs outside the throwaway databases seed.ts is allowed to
// write to (target.ts).
export interface SeedPlan {
  code: string;
  name: string;
  /** AR-17: reais as a decimal string. */
  price: string;
  interval: 'month' | 'year';
  activeJourneyLimit: number;
  stripePriceId: string;
  sortOrder: number;
}

export const SEED_PLANS: readonly SeedPlan[] = [
  {
    code: 'e2e-essencial',
    name: 'Essencial',
    price: '189.90',
    interval: 'month',
    activeJourneyLimit: 2,
    stripePriceId: 'price_e2e_essencial',
    sortOrder: 1,
  },
  {
    code: 'e2e-profissional',
    name: 'Profissional',
    price: '449.90',
    interval: 'month',
    activeJourneyLimit: 5,
    stripePriceId: 'price_e2e_profissional',
    sortOrder: 2,
  },
  {
    code: 'e2e-avancado',
    name: 'Avançado',
    price: '12990.00',
    interval: 'year',
    activeJourneyLimit: 15,
    stripePriceId: 'price_e2e_avancado',
    sortOrder: 3,
  },
];
