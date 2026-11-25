// SPEC-004 AR-27 / AR-29: the indexes migration 0012 builds in production are exactly the ones the
// schemas declare, so autoIndex (where it runs) and the migration never disagree, and an index
// changed in one place and not the other fails here.
import { describe, expect, it } from 'vitest';
import type { Schema } from 'mongoose';
import { AUCTION_IMPORT_INDEXES } from '../../migrations/0012-auction-import-model.migration.js';
import { PropertyChangeSchema } from '../changes/property-change.schema.js';
import { ImportRunSchema } from '../import-runs/import-run.schema.js';
import { AuctionSchema } from './auction.schema.js';

const declared = (schema: Schema) =>
  schema.indexes().map(([key, options]) => ({
    key,
    ...(options['name'] ? { name: options['name'] as string } : {}),
    ...(options['unique'] ? { unique: true } : {}),
  }));

describe('the indexes mirror the schemas (no drift)', () => {
  it('importruns', () => {
    expect(declared(ImportRunSchema)).toEqual(AUCTION_IMPORT_INDEXES['importruns']);
  });

  it('propertychanges', () => {
    expect(declared(PropertyChangeSchema)).toEqual(AUCTION_IMPORT_INDEXES['propertychanges']);
  });

  it('auctions: every index the migration builds is declared by the schema', () => {
    const schema = declared(AuctionSchema);
    for (const index of AUCTION_IMPORT_INDEXES['auctions'] ?? []) {
      expect(schema).toContainEqual(index);
    }
  });
});
