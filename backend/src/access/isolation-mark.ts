// SPEC-002 AR-16 / TS-14: every Mongoose schema says which isolation class it is in, and the
// isolation gate (backend/test/isolation/model-coverage.isolation.spec.ts) reads it from every model
// the API registers:
//
//   owned     the schema has an `ownerId` path (AR-11). No mark: the path IS the declaration, and
//             marking such a schema is an error. Needs an isolation spec through the API.
//   account   the account's own data (BR-002-02: favorites, saved filters, reminders, notification
//             logs), scoped by `userId` (AccountScopedRepository). Needs an isolation spec too.
//   internal  records the platform keeps about an account or for its own operation (the account
//             itself, sessions, one-time tokens, sign-in attempts): read only by the authenticated
//             account's own id or by operations code, never listed per owner. No spec required.
//   public    shared, not partitioned by any owner or account (the Caixa catalogue, job runs,
//             maintenance windows, coupons). No spec required.
//
// A schema with neither `ownerId` nor a mark fails the gate: a new collection must say which it is.
import type { Schema } from 'mongoose';

export const ISOLATION_KINDS = ['public', 'internal', 'account'] as const;
export type IsolationKind = (typeof ISOLATION_KINDS)[number];

export interface IsolationMark {
  readonly kind: IsolationKind;
  /** Why this class: what the collection holds and who reads it. Reviewed like code. */
  readonly reason: string;
}

// A schema option, not a property: Mongoose copies options when it clones a schema.
const OPTION = 'isolationMark';

type MarkedOptions = { [OPTION]?: IsolationMark };

/**
 * Declares the isolation class of a schema that has no `ownerId` (AR-16). Call it right after
 * `SchemaFactory.createForClass(...)`, next to the indexes.
 */
export function markIsolation(schema: Schema, mark: IsolationMark): void {
  if (schema.path('ownerId')) {
    throw new Error('A schema with ownerId is owned (AR-11); it takes no isolation mark (AR-16)');
  }
  if (!ISOLATION_KINDS.includes(mark.kind)) {
    throw new Error(`Unknown isolation kind "${String(mark.kind)}" (AR-16)`);
  }
  if (mark.reason.trim().length === 0) {
    throw new Error('An isolation mark needs its reason (AR-16)');
  }
  if (mark.kind === 'account' && !schema.path('userId')) {
    throw new Error('An account-owned schema is scoped by userId (BR-002-02); it has none');
  }
  (schema.options as MarkedOptions)[OPTION] = Object.freeze({ ...mark });
}

/** The mark a schema was given, if any. */
export function isolationMarkOf(schema: Schema): IsolationMark | undefined {
  return (schema.options as MarkedOptions)[OPTION];
}

/** AR-16: a collection is owned exactly when its schema has an `ownerId` path. */
export function isOwnedSchema(schema: Schema): boolean {
  return Boolean(schema.path('ownerId'));
}
