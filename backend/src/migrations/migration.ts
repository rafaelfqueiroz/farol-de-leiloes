// AR-29: a backfill or data reshape is a versioned migration in this directory, forward-only and
// idempotent, run as a gated step before the new code starts (DV-34). ADR-001 records why the
// runner is in-house; DEVELOPMENT §6 says how to write and run one.
import type { mongo } from 'mongoose';

/**
 * One migration. Its module lives in `NNNN-short-title.migration.ts` and is listed, in order, in
 * `registry.ts`.
 *
 * There is no `down`: migrations are forward-only (AR-29), so a rollback is redeploying the
 * previous image over data both versions read (expand/contract, AR-28, DV-33).
 */
export interface Migration {
  /** `NNNN-short-title`, the file name without `.migration.ts`. Applied in ascending order. */
  readonly id: string;
  /** One line for the run log: what the migration changes. */
  readonly description: string;
  /**
   * Applies the change through the driver, never through the application's Mongoose models: a
   * migration must keep doing what it did when it was written, whatever the schemas become.
   *
   * Must be idempotent. The runner records the id only after `up` resolves, so an `up` that
   * failed halfway runs again from the start; each change must therefore select only what is
   * still in the old shape.
   */
  up(db: mongo.Db): Promise<void>;
}
