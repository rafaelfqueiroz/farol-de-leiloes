// SPEC-010 (#10) BR-010-06, SC-25, SC-26, AR-28 (contract step), AR-29: the owner's decision of
// 2026-11-23 on issue #10 is to ERASE the legacy personal fields of the profile.
//
//   users   cpf, dateOfBirth, sex, address  → removed from every document that still holds one
//
// SPEC-001 (BR-001-25) stopped collecting them and left the stored values untouched, awaiting this
// decision. Nothing reads or writes them, so erasing them is invisible to the application, and the
// code that named them (schema, purge list, export) is removed in the same release. No other field
// is touched: the legacy billing fields (`role`, `subscriptionStatus`, the Stripe ids) are SPEC-012's
// contract step, not this one.
//
// Idempotent (AR-29): the filter selects only documents that still hold one of the four fields, so
// a second run matches nothing and changes nothing. Forward-only: the erased values are not
// recoverable, which is the point. The collection is named here, not reached through the schema
// (migration.ts), so it keeps working after the schema stops declaring the fields.
import { Logger } from '@nestjs/common';
import type { mongo } from 'mongoose';
import type { Migration } from './migration.js';

const COLLECTION = 'users';

/** The fields erased, in one place so the filter and the `$unset` can never disagree. */
export const ERASED_USER_FIELDS = ['cpf', 'dateOfBirth', 'sex', 'address'] as const;

export interface EraseLegacyProfileFieldsCounts {
  matched: number;
  modified: number;
}

export async function eraseLegacyProfileFields(
  db: mongo.Db,
): Promise<EraseLegacyProfileFieldsCounts> {
  const result = await db
    .collection(COLLECTION)
    .updateMany(
      { $or: ERASED_USER_FIELDS.map((field) => ({ [field]: { $exists: true } })) },
      { $unset: Object.fromEntries(ERASED_USER_FIELDS.map((field) => [field, ''])) },
    );

  return { matched: result.matchedCount, modified: result.modifiedCount };
}

export const eraseLegacyProfileFieldsMigration: Migration = {
  id: '0011-erase-legacy-profile-fields',
  description:
    'users: cpf, dateOfBirth, sex and address erased from every document (SPEC-010 BR-010-06)',
  async up(db) {
    const counts = await eraseLegacyProfileFields(db);
    // Counts only: no document content and no id reaches the log (SC-15).
    new Logger('Migrations').log(`0011-erase-legacy-profile-fields ${JSON.stringify(counts)}`);
  },
};
