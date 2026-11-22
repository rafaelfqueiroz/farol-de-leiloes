// SPEC-010 (#10) AR-27 / AR-29: the indexes migration 0010 builds in production are exactly the ones
// these schemas declare, so autoIndex (where it runs) and the migration never disagree, and an index
// changed in one place and not the other fails here.
import { describe, expect, it } from 'vitest';
import type { Schema } from 'mongoose';
import { RETENTION_LEGAL_INDEXES } from '../../migrations/0010-retention-legal-indexes.migration.js';
import { LegalValidationSchema } from './legal-validation.schema.js';
import { RetentionDeletionSchema } from './retention-deletion.schema.js';

describe('the indexes mirror the schemas (no drift)', () => {
  const declared = (schema: Schema) =>
    schema.indexes().map(([key, options]) => ({
      key,
      ...(options['name'] ? { name: options['name'] as string } : {}),
      ...(options['unique'] ? { unique: true } : {}),
      ...(options['partialFilterExpression']
        ? { partialFilterExpression: options['partialFilterExpression'] as object }
        : {}),
    }));

  it('retentionDeletions', () => {
    expect(declared(RetentionDeletionSchema)).toEqual(
      RETENTION_LEGAL_INDEXES['retentionDeletions'],
    );
  });

  it('legalValidations', () => {
    expect(declared(LegalValidationSchema)).toEqual(RETENTION_LEGAL_INDEXES['legalValidations']);
  });
});
