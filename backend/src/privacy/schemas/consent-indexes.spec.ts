// SPEC-010 (#10) AR-27 / AR-29: the indexes migration 0008 builds in production are exactly the ones
// these schemas declare, so autoIndex (where it runs) and the migration never disagree, and an
// index changed in one place and not the other fails here.
import { describe, expect, it } from 'vitest';
import type { Schema } from 'mongoose';
import { CONSENT_INDEXES } from '../../migrations/0008-consent-indexes.migration.js';
import { ConsentSchema } from './consent.schema.js';
import { WhatsappConsentSchema } from './whatsapp-consent.schema.js';

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

  it('consents', () => {
    expect(declared(ConsentSchema)).toEqual(CONSENT_INDEXES['consents']);
  });

  it('whatsappConsents', () => {
    expect(declared(WhatsappConsentSchema)).toEqual(CONSENT_INDEXES['whatsappConsents']);
  });
});
