// SPEC-010 BR-010-08, BR-010-09, BR-010-15 / SC-27: how a module tells the privacy part what personal
// data it holds about an account. Every module that stores a person's data registers one provider
// (through its own repository, AR-09); the export, the "my data" view and the purge job walk the
// registry and know nothing of the modules behind it. A new owned or account collection decides its
// provider in its own PR (SC-27), and the registry meta-test (test/isolation) fails the build for a
// model with a user path that no provider covers and no retained entry declares.
import type { AccessContext } from '../../access/access-context.js';

/** What a caller may ask a provider to bound. */
export interface CollectOptions {
  /**
   * At most this many records of each list the provider holds (the "my data" view, which shows a
   * bounded page and points to the export). Absent means everything, read in pages: the export is
   * COMPLETE (BR-010-08, BR-010-09). A provider that honours it marks what it cut with
   * `truncated: true` and `totals: { <list>: <how many there are> }` (see `listSection`).
   */
  readonly limit?: number;
}

export interface PersonalDataProvider {
  /**
   * The key of this provider's part in the export and in the "my data" view: letters and digits,
   * starting with a letter, unique across providers (`favorites`, `savedFilters`).
   */
  readonly name: string;

  /**
   * The Mongoose model names (the registered ones, e.g. `FavoriteEntity`) whose records of an
   * account this provider collects AND purges. A model whose records are RETAINED on purpose is not
   * listed here but in `RETAINED_MODELS` with its reason.
   */
  readonly models: readonly string[];

  /**
   * The account's own data of this provider as plain, JSON-serialisable values, read under the
   * request's `AccessContext` (BR-010-10: never more than the account sees as itself; the account
   * is `ctx.accountId`, never a parameter). Money is a string, never a number (AR-17); a password
   * hash, a token hash or a stored secret never appears in it. SC-15: this value is the export's
   * content, so it is never logged.
   */
  collect(ctx: AccessContext, options?: CollectOptions): Promise<Record<string, unknown>>;

  /**
   * Deletes or irreversibly anonymises this provider's records of the CLOSED account `userId`
   * (BR-010-15). Called only by the purge job, never from a request (AR-31). Idempotent: running it
   * again after a crash, or on an account with nothing left, deletes nothing and answers 0. A
   * provider whose records the purge must keep answers 0 without touching them.
   */
  purge(userId: string): Promise<{ deleted: number }>;
}
