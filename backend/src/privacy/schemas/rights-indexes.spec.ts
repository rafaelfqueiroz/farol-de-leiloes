// SPEC-010 (#10) AR-27 / AR-29: the indexes migration 0009 builds in production are exactly the ones
// these schemas declare, so autoIndex (where it runs) and the migration never disagree, and an index
// changed in one place and not the other fails here.
import { describe, expect, it } from 'vitest';
import type { Schema } from 'mongoose';
import { PRIVACY_RIGHTS_INDEXES } from '../../migrations/0009-privacy-rights-indexes.migration.js';
import { ActorPseudonymSchema } from './actor-pseudonym.schema.js';
import { DataExportSchema } from './data-export.schema.js';

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

  it('dataExports', () => {
    expect(declared(DataExportSchema)).toEqual(PRIVACY_RIGHTS_INDEXES['dataExports']);
  });

  it('actorPseudonyms', () => {
    expect(declared(ActorPseudonymSchema)).toEqual(PRIVACY_RIGHTS_INDEXES['actorPseudonyms']);
  });
});
