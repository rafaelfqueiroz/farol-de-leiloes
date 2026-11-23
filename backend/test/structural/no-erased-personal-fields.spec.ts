// SC-26, SPEC-010 BR-010-06: a CPF is never stored unless a spec requires it. The CPF, date of birth,
// sex and address were erased from `users` by migration 0011-erase-legacy-profile-fields (owner
// decision on issue #10, 2026-11-23). This fails the day one of those names becomes a path of the
// user schema again, on any nesting level (`address.street` counts), before any code writes it.
// A spec that really needs one (SPEC-012 may ask for a CPF for billing) states its purpose, adds it
// to the schema of ITS collection and removes the name from ERASED_PERSONAL with that decision.
import { describe, expect, it } from 'vitest';
import { ERASED_PERSONAL } from '../support/profile-fields.js';
import { UserSchema } from '../../src/users/schemas/user.schema.js';

describe('SC-26: the user schema holds no erased personal field', () => {
  const paths = Object.keys(UserSchema.paths);

  it('names exactly the four erased fields', () => {
    expect([...ERASED_PERSONAL]).toEqual(['cpf', 'dateOfBirth', 'sex', 'address']);
  });

  it('has a path for the schema at all (the walk is not vacuous)', () => {
    expect(paths).toContain('email');
    expect(paths).toContain('phone');
  });

  it.each(ERASED_PERSONAL)('has no %s path, flat or nested', (name) => {
    const offenders = paths.filter((path) => path === name || path.startsWith(`${name}.`));
    expect(offenders).toEqual([]);
  });

  it.each(ERASED_PERSONAL)('declares no %s path lookup or virtual either', (name) => {
    expect(UserSchema.path(name)).toBeUndefined();
    expect(Object.keys(UserSchema.virtuals)).not.toContain(name);
  });
});
