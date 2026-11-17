// SPEC-002 (#2) AR-27 / AR-29: the indexes migration 0005 builds in production are exactly the ones
// these schemas declare, so autoIndex (where it runs) and the migration never disagree, and an
// index changed in one place and not the other fails here.
import { describe, expect, it } from 'vitest';
import { ADMIN_ACCESS_INDEXES } from '../../migrations/0005-admin-access-indexes.migration.js';
import { AdminAccessLogSchema } from './admin-access-log.schema.js';
import { SupportAccessGrantSchema } from './support-access-grant.schema.js';

describe('the indexes mirror the schemas (no drift)', () => {
  const declared = (schema: typeof SupportAccessGrantSchema | typeof AdminAccessLogSchema) =>
    schema.indexes().map(([key, options]) => ({
      key,
      ...(options['name'] ? { name: options['name'] as string } : {}),
      ...(options['unique'] ? { unique: true } : {}),
      ...(options['partialFilterExpression']
        ? { partialFilterExpression: options['partialFilterExpression'] as object }
        : {}),
    }));

  it('supportAccessGrants', () => {
    expect(declared(SupportAccessGrantSchema)).toEqual(ADMIN_ACCESS_INDEXES['supportAccessGrants']);
  });

  it('adminAccessLogs', () => {
    expect(declared(AdminAccessLogSchema)).toEqual(ADMIN_ACCESS_INDEXES['adminAccessLogs']);
  });
});
