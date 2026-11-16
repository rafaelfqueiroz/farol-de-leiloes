// RNF-13 / BR-001-29: the cheap half of the schema walk. Every path of UserSchema is classified in
// exactly one list (test/support/profile-fields.ts); the real-database half, which tries to write
// each path through the service, is test/integration/profile-allowlist-schema.spec.ts.
import { describe, expect, it } from 'vitest';
import {
  ALL_CLASSIFIED,
  BOOKKEEPING,
  CONTACT_DETAILS,
  EMAIL_READ_ONLY,
  HOSTILE_VALUES,
  PROFILE_EDITABLE,
  PROTECTED,
} from '../../test/support/profile-fields.js';
import { UserSchema } from './schemas/user.schema.js';

describe('BR-001-29: every user schema path is classified', () => {
  const paths = Object.keys(UserSchema.paths);

  it('has no path outside the classification (a new field must be classified first)', () => {
    expect(paths.filter((path) => !ALL_CLASSIFIED.includes(path))).toEqual([]);
  });

  it('classifies no path that the schema does not have', () => {
    // `__v` is added when a model is compiled from the schema, so it is not a schema path yet.
    const attributes = ALL_CLASSIFIED.filter((path) => path !== '__v');
    expect(attributes.filter((path) => !paths.includes(path))).toEqual([]);
  });

  it('classifies each path once', () => {
    expect(new Set(ALL_CLASSIFIED).size).toBe(ALL_CLASSIFIED.length);
  });

  it('lets an account holder edit exactly name and phone', () => {
    expect([...PROFILE_EDITABLE]).toEqual(['name', 'phone']);
    expect([...EMAIL_READ_ONLY]).toEqual(['email']);
  });

  it('has a hostile value for every path that is not editable', () => {
    const nonEditable = [...EMAIL_READ_ONLY, ...CONTACT_DETAILS, ...PROTECTED];
    expect(nonEditable.filter((path) => !(path in HOSTILE_VALUES))).toEqual([]);
    expect(BOOKKEEPING).toContain('_id');
  });
});
