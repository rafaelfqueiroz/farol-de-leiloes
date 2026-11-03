// AR-29 / DV-34: the runner applies pending migrations in order, records each once it succeeds,
// skips what is recorded and stops at the first failure. The MongoDB log and a real migration are
// covered by test/integration/migrations.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { mongo } from 'mongoose';
import { FakeClock } from '../../test/fakes/fake-clock';
import { FakeMigrationLog } from '../../test/fakes/fake-migration-log';
import type { Migration } from './migration';
import { assertMigrationOrder, MigrationFailedError, runMigrations } from './migration-runner';
import { MIGRATIONS } from './registry';

const NOW = new Date('2026-11-03T12:00:00.000Z');
// The runner hands the database to each `up` and never touches it itself.
const DB = { databaseName: 'not-a-real-database' } as unknown as mongo.Db;

function migration(id: string, up: Migration['up'] = async () => undefined): Migration {
  return { id, description: `does ${id}`, up: vi.fn(up) };
}

function run(migrations: readonly Migration[], log = new FakeMigrationLog()) {
  return runMigrations(DB, migrations, log, new FakeClock(NOW));
}

describe('runMigrations', () => {
  it('applies every pending migration in registry order, recording each with the clock time', async () => {
    const order: string[] = [];
    const first = migration('0001-first', async (db) => {
      expect(db).toBe(DB);
      order.push('0001-first');
    });
    const second = migration('0002-second', async () => {
      order.push('0002-second');
    });
    const log = new FakeMigrationLog();

    await expect(run([first, second], log)).resolves.toEqual({
      applied: ['0001-first', '0002-second'],
      skipped: [],
    });
    expect(order).toEqual(['0001-first', '0002-second']);
    expect([...log.records]).toEqual([
      ['0001-first', NOW],
      ['0002-second', NOW],
    ]);
  });

  it('skips a recorded migration and leaves its record as it was', async () => {
    const earlier = new Date('2026-10-01T00:00:00.000Z');
    const first = migration('0001-first');
    const second = migration('0002-second');
    const log = new FakeMigrationLog({ '0001-first': earlier });

    await expect(run([first, second], log)).resolves.toEqual({
      applied: ['0002-second'],
      skipped: ['0001-first'],
    });
    expect(first.up).not.toHaveBeenCalled();
    expect(log.records.get('0001-first')).toBe(earlier);
  });

  it('is a no-op the second time: nothing runs, nothing is recorded again', async () => {
    const only = migration('0001-only');
    const log = new FakeMigrationLog();

    await run([only], log);
    await expect(run([only], log)).resolves.toEqual({ applied: [], skipped: ['0001-only'] });
    expect(only.up).toHaveBeenCalledTimes(1);
    expect(log.records.size).toBe(1);
  });

  it('stops at the first failure: it is not recorded and nothing after it runs', async () => {
    const first = migration('0001-first');
    const failing = migration('0002-failing', async () => {
      throw new Error('E11000 something went wrong');
    });
    const third = migration('0003-third');
    const log = new FakeMigrationLog();

    const failure = await run([first, failing, third], log).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MigrationFailedError);
    expect(failure).toMatchObject({
      migrationId: '0002-failing',
      message: 'Migration 0002-failing failed, nothing after it ran: E11000 something went wrong',
    });
    expect((failure as MigrationFailedError).failure).toEqual(
      new Error('E11000 something went wrong'),
    );
    expect(third.up).not.toHaveBeenCalled();
    expect([...log.records.keys()]).toEqual(['0001-first']);
  });

  it('retries a failed migration on the next run, and then goes on', async () => {
    let attempts = 0;
    const flaky = migration('0001-flaky', async () => {
      attempts += 1;
      if (attempts === 1) throw 'connection reset';
    });
    const next = migration('0002-next');
    const log = new FakeMigrationLog();

    await expect(run([flaky, next], log)).rejects.toThrow(
      'Migration 0001-flaky failed, nothing after it ran: connection reset',
    );
    await expect(run([flaky, next], log)).resolves.toEqual({
      applied: ['0001-flaky', '0002-next'],
      skipped: [],
    });
  });

  it('warns about recorded ids the code does not know, and leaves them alone (DV-33)', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const log = new FakeMigrationLog({ '0009-from-a-newer-image': NOW });

    await expect(run([migration('0001-first')], log)).resolves.toEqual({
      applied: ['0001-first'],
      skipped: [],
    });
    expect(warn).toHaveBeenCalledWith(
      'Applied migrations this code does not know (left as they are): 0009-from-a-newer-image',
    );
    expect(log.records.has('0009-from-a-newer-image')).toBe(true);
  });

  it('refuses a registry out of order before touching the log', async () => {
    const log = new FakeMigrationLog();
    const appliedIds = vi.spyOn(log, 'appliedIds');

    await expect(run([migration('0002-b'), migration('0001-a')], log)).rejects.toThrow(
      'Migration "0001-a" is listed after "0002-b": ids must ascend (AR-29)',
    );
    expect(appliedIds).not.toHaveBeenCalled();
  });
});

describe('assertMigrationOrder', () => {
  it('accepts ascending NNNN-short-title ids, and an empty list', () => {
    expect(() => assertMigrationOrder([])).not.toThrow();
    expect(() =>
      assertMigrationOrder([migration('0001-a'), migration('0002-b-c'), migration('0010-d1')]),
    ).not.toThrow();
  });

  it('refuses a duplicate id', () => {
    expect(() => assertMigrationOrder([migration('0001-a'), migration('0001-a')])).toThrow(
      'ids must ascend',
    );
  });

  it.each(['1-a', '0001', '0001-', '0001_a', '0001-Money', '0001-a--b', 'abcd-a'])(
    'refuses the malformed id %s',
    (id) => {
      expect(() => assertMigrationOrder([migration(id)])).toThrow('is not NNNN-short-title');
    },
  );

  it('holds for the real registry', () => {
    expect(() => assertMigrationOrder(MIGRATIONS)).not.toThrow();
    expect(MIGRATIONS.map((m) => m.id)).toEqual(['0001-money-decimal128']);
  });
});
