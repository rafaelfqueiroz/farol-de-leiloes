// SPEC-012 BR-012-02: the plan catalog file operators hand to `npm run plans:upsert -- --file`.
// Validated here, in full, before anything reaches the database (AR-34's spirit for a script, Zod
// for configuration, DEVELOPMENT §1). Pure: no I/O, so it is unit-tested (TS-01).
//
//   { "plans": [ {
//       "code": "escritorio-5", "name": "Escritório 5", "price": "199.90", "interval": "month",
//       "activeJourneyLimit": 5, "stripePriceId": "price_1Abc...", "status": "OFFERED",
//       "sortOrder": 10 } ] }
//
// Money is a string of reais (AR-17): a JSON number would be a float.
import { z } from 'zod';
import { Decimal, isMoneyString, parseMoney } from '../../common/money/money.js';
import { PLAN_INTERVALS, PLAN_STATUSES, type PlanDefinition } from '../plan.js';

const catalogEntry = z
  .object({
    code: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'lowercase letters, digits, - and _'),
    name: z.string().trim().min(1).max(80),
    price: z
      .string()
      .refine(isMoneyString, 'a string of reais such as "199.90"')
      .refine((value) => isMoneyString(value) && parseMoney(value).greaterThan(0), 'positive'),
    interval: z.enum(PLAN_INTERVALS),
    // BR-012-01: a positive integer.
    activeJourneyLimit: z.number().int().positive().max(100_000),
    stripePriceId: z.string().regex(/^price_[A-Za-z0-9_]+$/, 'a provider price id (price_...)'),
    status: z.enum(PLAN_STATUSES).default('OFFERED'),
    sortOrder: z.number().int().default(0),
  })
  .strict();

const catalogFile = z
  .object({ plans: z.array(catalogEntry).min(1).max(100) })
  .strict()
  .superRefine((file, ctx) => {
    for (const key of ['code', 'stripePriceId'] as const) {
      const seen = new Set<string>();
      file.plans.forEach((plan, index) => {
        if (seen.has(plan[key])) {
          ctx.addIssue({
            code: 'custom',
            path: ['plans', index, key],
            message: `duplicate ${key} in the file`,
          });
        }
        seen.add(plan[key]);
      });
    }
  });

export type PlanCatalogParse = { ok: true; plans: PlanDefinition[] } | { ok: false; error: string };

/** Validates the parsed JSON of a catalog file; the error names fields, never echoes values. */
export function parsePlanCatalog(json: unknown): PlanCatalogParse {
  const parsed = catalogFile.safeParse(json);
  if (!parsed.success) {
    const where = parsed.error.issues
      .slice(0, 10)
      .map((issue) => `${issue.path.join('.') || 'file'}: ${issue.message}`)
      .join('; ');
    return { ok: false, error: `invalid catalog file (${where})` };
  }
  return {
    ok: true,
    plans: parsed.data.plans.map((plan) => ({ ...plan, price: new Decimal(plan.price) })),
  };
}

export const PLANS_UPSERT_USAGE = 'usage: npm run plans:upsert -- --file <catalog.json>';

export type PlansUpsertArgs = { ok: true; file: string } | { ok: false; error: string };

/** `--file <path>` (or `--file=<path>`). */
export function parsePlansUpsertArgs(argv: readonly string[]): PlansUpsertArgs {
  let file: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === '--file') {
      file = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--file=')) {
      file = arg.slice('--file='.length);
    } else {
      return { ok: false, error: `unknown argument; ${PLANS_UPSERT_USAGE}` };
    }
  }
  if (!file) return { ok: false, error: `a --file is required; ${PLANS_UPSERT_USAGE}` };
  return { ok: true, file };
}
