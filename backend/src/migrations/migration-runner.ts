// AR-29 / DV-34: applies the pending migrations in order and stops at the first failure, so the
// deploy that runs it aborts and leaves the running version untouched. ADR-001.
import { Logger } from '@nestjs/common';
import type { mongo } from 'mongoose';
import type { Clock } from '../common/clock/clock.js';
import { errorMessage } from '../common/error-message.js';
import type { Migration } from './migration.js';
import type { MigrationLog } from './migration-log.js';

/** `0001-money-decimal128`: four digits, a hyphen, a lowercase kebab-case title. */
const MIGRATION_ID = /^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A migration's `up` rejected; the run stopped there. `failure` is what it rejected with. */
export class MigrationFailedError extends Error {
  constructor(
    readonly migrationId: string,
    readonly failure: unknown,
  ) {
    super(`Migration ${migrationId} failed, nothing after it ran: ${errorMessage(failure)}`);
    this.name = 'MigrationFailedError';
  }
}

export interface MigrationRun {
  /** Ids applied by this run, in the order they ran. */
  readonly applied: readonly string[];
  /** Ids already recorded before this run, left alone. */
  readonly skipped: readonly string[];
}

/**
 * The registry must list migrations by ascending id with no gaps in form or duplicates; a list
 * that breaks this is a programming error, refused before anything touches the database.
 */
export function assertMigrationOrder(migrations: readonly Migration[]): void {
  let previous: string | undefined;
  for (const { id } of migrations) {
    if (!MIGRATION_ID.test(id)) {
      throw new Error(`Migration id "${id}" is not NNNN-short-title (AR-29)`);
    }
    if (previous !== undefined && id <= previous) {
      throw new Error(`Migration "${id}" is listed after "${previous}": ids must ascend (AR-29)`);
    }
    previous = id;
  }
}

/**
 * Runs every migration not yet in `log`, in registry order. Each is recorded, with the clock's
 * time (AR-24), only once its `up` resolves. The first failure stops the run: later migrations
 * are not attempted and the failed one stays unrecorded, so the next run retries it (its `up` is
 * idempotent, AR-29).
 */
export async function runMigrations(
  db: mongo.Db,
  migrations: readonly Migration[],
  log: MigrationLog,
  clock: Clock,
  logger: Logger = new Logger('Migrations'),
): Promise<MigrationRun> {
  assertMigrationOrder(migrations);
  const recorded = await log.appliedIds();

  // Forward-only (AR-29): a database ahead of the code is expected after a rollback to an
  // earlier image (DV-33), and the older code does not undo what it does not know.
  const known = new Set(migrations.map((migration) => migration.id));
  const unknown = [...recorded].filter((id) => !known.has(id)).sort();
  if (unknown.length > 0) {
    logger.warn(`Applied migrations this code does not know (left as they are): ${unknown}`);
  }

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const migration of migrations) {
    if (recorded.has(migration.id)) {
      skipped.push(migration.id);
      continue;
    }
    logger.log(`Applying ${migration.id}: ${migration.description}`);
    try {
      await migration.up(db);
    } catch (error) {
      throw new MigrationFailedError(migration.id, error);
    }
    await log.record(migration.id, clock.now());
    applied.push(migration.id);
  }

  logger.log(`Migrations done: ${applied.length} applied, ${skipped.length} already applied`);
  return { applied, skipped };
}
