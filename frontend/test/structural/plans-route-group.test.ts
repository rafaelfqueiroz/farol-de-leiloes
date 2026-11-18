// @vitest-environment node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SPEC-012 owner decision 11: /plans is PUBLIC, and publicness is ONE switch: the folder it lives
// in. `(shell)/plans` is public (the guest top bar); `(shell)/(authenticated)/plans` would be
// private. Exactly one of the two exists, so the page can never be both (or neither), and the
// office plan stays signed-in only.
const app = resolve(import.meta.dirname, '../../app');
const page = (...parts: string[]) => existsSync(resolve(app, ...parts, 'page.tsx'));

describe('where the plans pages live (DESIGN.md §6)', () => {
  it('has the plans page in exactly one place: the public (shell) group', () => {
    expect(page('(shell)', 'plans')).toBe(true);
    expect(page('(shell)', '(authenticated)', 'plans')).toBe(false);
  });

  it('keeps the office plan behind the authentication guard, and the checkout results outside the shell', () => {
    expect(page('(shell)', '(authenticated)', 'office', 'plan')).toBe(true);
    expect(page('plans', 'success')).toBe(true);
    expect(page('plans', 'cancel')).toBe(true);
  });
});
