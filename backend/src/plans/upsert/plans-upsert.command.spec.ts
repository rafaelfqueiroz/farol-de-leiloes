// SPEC-012 BR-012-02: the operator script prints counts only (SC-15) and exits non-zero when refused.
import { describe, expect, it } from 'vitest';
import type { PlansService } from '../plans.service.js';
import { exitCodeOf, PlansUpsertCommand, summaryOf } from './plans-upsert.command.js';

describe('plans:upsert outcome', () => {
  it('exits 0 and prints the three counts when the catalog was written', () => {
    const outcome = { result: 'applied', created: 2, updated: 1, unchanged: 3 } as const;

    expect(exitCodeOf(outcome)).toBe(0);
    expect(summaryOf(outcome)).toBe('plans:upsert: created 2, updated 1, unchanged 3');
  });

  it.each(['refused_duplicate_price', 'refused_price_changed'] as const)(
    'exits 1 for %s and says nothing was written',
    (result) => {
      const outcome = { result, conflicts: 2 } as const;

      expect(exitCodeOf(outcome)).toBe(1);
      expect(summaryOf(outcome)).toBe(`plans:upsert: ${result} (2); nothing was written`);
    },
  );

  it('hands the definitions to the catalog service', async () => {
    const seen: unknown[] = [];
    const plans = {
      upsertCatalog: (definitions: unknown) => {
        seen.push(definitions);
        return Promise.resolve({ result: 'applied', created: 0, updated: 0, unchanged: 0 });
      },
    } as unknown as PlansService;

    await new PlansUpsertCommand(plans).run([]);

    expect(seen).toEqual([[]]);
  });
});
