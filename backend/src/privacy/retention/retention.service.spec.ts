// SPEC-010 BR-010-18..21, BR-010-24: the retention service over hand-written fakes (TS-03): the
// examples of the acceptance criteria, the setting moving the dates, the source never trusted, a
// failure that leaves no log row, and logs that are counts. The unique index, the lock and the
// concurrent runs against MongoDB are in test/integration/document-retention.spec.ts.
import { describe, expect, it } from 'vitest';
import { spyOnLogger } from '../../../test/support/logger-spy.js';
import { FakeClock } from '../../../test/fakes/fake-clock.js';
import {
  FakeClosedJourneyFilesSource,
  hexId,
} from '../../../test/fakes/fake-closed-journey-files-source.js';
import { FakeRetentionDeletionsRepository } from '../../../test/fakes/fake-privacy-repositories.js';
import { testBusinessConfig } from '../../../test/support/test-env.js';
import {
  RETENTION_BATCH_SIZE,
  RETENTION_LOG_ATTEMPTS,
  RetentionService,
} from './retention.service.js';

/** Noon in Brasília (15:00 UTC, Brasília is UTC-3 in these years) of the given day. */
const noonOn = (date: string) => new Date(`${date}T15:00:00.000Z`);

function build(now: Date, env: Record<string, string> = {}) {
  const clock = new FakeClock(now);
  const source = new FakeClosedJourneyFilesSource();
  const deletions = new FakeRetentionDeletionsRepository();
  const service = new RetentionService(source, deletions as never, clock, testBusinessConfig(env));
  return { service, source, deletions, clock };
}

describe('BR-010-19: kept through the anniversary, deleted from the next day', () => {
  it('15/03/2027 is present on 15/03/2032 and gone on 16/03/2032', async () => {
    const { service, source, deletions, clock } = build(noonOn('2032-03-15'));
    source.add('2027-03-15', { files: 4 });

    expect(await service.purgeDue()).toMatchObject({ deleted: 0, files: 0, notDue: 0, failed: 0 });
    expect(source.purgeCalls).toEqual([]);
    expect(deletions.rows).toEqual([]);

    clock.set(noonOn('2032-03-16'));
    expect(await service.purgeDue()).toMatchObject({ deleted: 1, files: 4 });
    expect(deletions.rows).toHaveLength(1);
  });

  it('29/02/2028 is present on 28/02/2033 and deleted on 01/03/2033', async () => {
    const { service, source, clock } = build(noonOn('2033-02-28'));
    source.add('2028-02-29', { files: 2 });

    expect((await service.purgeDue()).deleted).toBe(0);
    clock.set(noonOn('2033-03-01'));
    expect(await service.purgeDue()).toMatchObject({ deleted: 1, files: 2 });
  });

  it('a lost bid and a cancelled journey follow the same rule as a won one (D-41)', async () => {
    const { service, source, deletions, clock } = build(noonOn('2032-03-15'));
    const won = source.add('2027-03-15', { kind: 'won' });
    const lost = source.add('2027-03-15', { kind: 'lost' });
    const cancelled = source.add('2027-03-15', { kind: 'cancelled' });

    expect((await service.purgeDue()).deleted).toBe(0);
    clock.set(noonOn('2032-03-16'));
    expect((await service.purgeDue()).deleted).toBe(3);
    expect(deletions.rows.map((row) => row.journeyId).sort()).toEqual(
      [won, lost, cancelled].map((j) => j.journeyId).sort(),
    );
  });

  it('changing the setting from 5 to 6 years moves the deletion date by a year, no code change', async () => {
    const five = build(noonOn('2032-03-16'), { DOCUMENT_RETENTION_YEARS: '5' });
    five.source.add('2027-03-15');
    expect((await five.service.purgeDue()).deleted).toBe(1);

    const six = build(noonOn('2032-03-16'), { DOCUMENT_RETENTION_YEARS: '6' });
    six.source.add('2027-03-15');
    expect((await six.service.purgeDue()).deleted).toBe(0);
    six.clock.set(noonOn('2033-03-15'));
    expect((await six.service.purgeDue()).deleted).toBe(0);
    six.clock.set(noonOn('2033-03-16'));
    expect((await six.service.purgeDue()).deleted).toBe(1);
  });

  it('counts the Brasília day, not the UTC one: 23:59 in Brasília is still the day before in the rule', async () => {
    // 16/03/2032 02:59 UTC is 15/03/2032 23:59 in Brasília: the documents are still kept.
    const { service, source, clock } = build(new Date('2032-03-16T02:59:00.000Z'));
    source.add('2027-03-15');
    expect((await service.purgeDue()).deleted).toBe(0);
    // 16/03/2032 03:00 UTC is 00:00 on 16/03 in Brasília: gone.
    clock.set(new Date('2032-03-16T03:00:00.000Z'));
    expect((await service.purgeDue()).deleted).toBe(1);
  });

  it('asks the source for journeys closed at or before today minus N years', async () => {
    const { service, source } = build(noonOn('2033-03-01'));
    await service.purgeDue();
    expect(source.listed).toEqual([{ cutoff: '2028-03-01', limit: RETENTION_BATCH_SIZE }]);
  });
});

describe('the source is never trusted (BR-010-19)', () => {
  it('a journey that is not due yet is not purged even when the source lists it', async () => {
    const { service, source, deletions } = build(noonOn('2032-03-15'));
    source.ignoreCutoff = true;
    // 15/03/2027 is the last day of its retention on 15/03/2032: listed at the cutoff, not due, and
    // not an anomaly. 01/01/2031 is far beyond the cutoff: the source broke its contract.
    const early = source.add('2027-03-15');
    const open = source.add('2031-01-01');

    expect(await service.purgeDue()).toMatchObject({ deleted: 0, notDue: 1, failed: 0 });
    expect(source.purgeCalls).toEqual([]);
    expect(deletions.rows).toEqual([]);
    expect(source.journeys.find((j) => j.journeyId === early.journeyId)?.purged).toBe(false);
    expect(source.journeys.find((j) => j.journeyId === open.journeyId)?.purged).toBe(false);
  });

  it('deletes the due ones and leaves the not-due ones when a source mixes them', async () => {
    const { service, source } = build(noonOn('2032-03-16'));
    source.ignoreCutoff = true;
    source.add('2027-03-15');
    source.add('2027-03-16'); // the last day of its retention is 16/03/2032: kept
    source.add('2029-01-01'); // beyond the cutoff

    expect(await service.purgeDue()).toMatchObject({ deleted: 1, notDue: 1 });
  });

  it('a malformed closing date is a failure of that journey, nothing is deleted for it', async () => {
    const { service, source, deletions } = build(noonOn('2032-03-16'));
    source.ignoreCutoff = true;
    source.add('15/03/2027');

    expect(await service.purgeDue()).toMatchObject({ deleted: 0, failed: 1 });
    expect(source.purgeCalls).toEqual([]);
    expect(deletions.rows).toEqual([]);
  });

  it('an id that is not an ObjectId is refused BEFORE any file is deleted', async () => {
    const { service, source } = build(noonOn('2032-03-16'));
    const bad = source.add('2027-03-15');
    (bad as { journeyId: string }).journeyId = 'not-an-object-id';
    const badOwner = source.add('2027-03-15');
    (badOwner as { ownerId: string }).ownerId = 'xyz';

    expect(await service.purgeDue()).toMatchObject({ deleted: 0, failed: 2 });
    expect(source.purgeCalls).toEqual([]);
  });
});

describe('the log row (BR-010-21)', () => {
  it('holds the journey, the owner ids, the number of files and the date, and nothing else', async () => {
    const { service, source, deletions } = build(noonOn('2032-03-16'));
    const journey = source.add('2027-03-15', { files: 7, ownerType: 'self_advised' });

    await service.purgeDue();

    expect(deletions.rows).toEqual([
      {
        journeyId: journey.journeyId,
        journeyOwnerType: 'self_advised',
        journeyOwnerId: journey.ownerId,
        fileCount: 7,
        deletedAt: noonOn('2032-03-16'),
      },
    ]);
  });

  it('a failing deletion leaves no row and the next run retries it', async () => {
    const { service, source, deletions } = build(noonOn('2032-03-16'));
    const journey = source.add('2027-03-15', { files: 2 });
    source.failing.add(journey.journeyId);

    expect(await service.purgeDue()).toMatchObject({ deleted: 0, failed: 1 });
    expect(deletions.rows).toEqual([]);

    source.failing.clear();
    expect(await service.purgeDue()).toMatchObject({ deleted: 1, files: 2, failed: 0 });
    expect(deletions.rows).toHaveLength(1);
  });

  it('a failing journey does not stop the others, and is not retried within the run', async () => {
    const { service, source, deletions } = build(noonOn('2032-03-16'));
    const bad = source.add('2027-01-01');
    source.add('2027-02-01');
    source.add('2027-03-01');
    source.failing.add(bad.journeyId);

    expect(await service.purgeDue()).toMatchObject({ deleted: 2, failed: 1 });
    expect(source.purgeCalls.filter((id) => id === bad.journeyId)).toHaveLength(1);
    expect(deletions.rows).toHaveLength(2);
  });

  it('is idempotent: a duplicate row is success and the files are not counted twice', async () => {
    const { service, source, deletions } = build(noonOn('2032-03-16'));
    const journey = source.add('2027-03-15', { files: 5 });
    // A crash after the deletion and before the row: the source lists it again, nothing is left.
    await source.purgeFiles(journey.journeyId);
    journey.purged = false;

    expect(await service.purgeDue()).toMatchObject({ deleted: 1, files: 0, failed: 0 });
    expect(deletions.rows).toHaveLength(1);
    // And a row that exists already (another replica logged it first) is success too.
    journey.purged = false;
    expect(await service.purgeDue()).toMatchObject({ deleted: 1, failed: 0 });
    expect(deletions.rows).toHaveLength(1);
  });

  it('retries a transient log failure and succeeds', async () => {
    const { service, source, deletions } = build(noonOn('2032-03-16'));
    source.add('2027-03-15');
    deletions.failures = RETENTION_LOG_ATTEMPTS - 1;

    expect(await service.purgeDue()).toMatchObject({ deleted: 1, failed: 0, unrecorded: 0 });
    expect(deletions.rows).toHaveLength(1);
  });

  it('reports a journey whose files are gone but whose row could not be written', async () => {
    const { service, source, deletions } = build(noonOn('2032-03-16'));
    source.add('2027-03-15');
    deletions.failures = RETENTION_LOG_ATTEMPTS;

    expect(await service.purgeDue()).toMatchObject({ deleted: 0, failed: 1, unrecorded: 1 });
    expect(deletions.rows).toEqual([]);
  });
});

describe('batches', () => {
  it('goes on past the first batch while it makes progress', async () => {
    const { service, source } = build(noonOn('2032-03-16'));
    for (let i = 0; i < RETENTION_BATCH_SIZE + 5; i += 1) source.add('2027-03-15', { files: 1 });

    expect(await service.purgeDue()).toMatchObject({
      deleted: RETENTION_BATCH_SIZE + 5,
      failed: 0,
    });
    expect(source.listed.length).toBeGreaterThanOrEqual(2);
  });

  it('stops when a whole batch deleted nothing, instead of asking again for the same journeys', async () => {
    const { service, source } = build(noonOn('2032-03-16'));
    for (let i = 0; i < RETENTION_BATCH_SIZE; i += 1) {
      source.failing.add(source.add('2027-03-15').journeyId);
    }

    expect(await service.purgeDue()).toMatchObject({ deleted: 0, failed: RETENTION_BATCH_SIZE });
    expect(source.listed).toHaveLength(1);
  });

  it('lists nothing and does nothing with the default source (before SPEC-017)', async () => {
    const { service, source } = build(noonOn('2032-03-16'));
    expect(await service.purgeDue()).toEqual({
      deleted: 0,
      files: 0,
      notDue: 0,
      failed: 0,
      unrecorded: 0,
    });
    expect(source.purgeCalls).toEqual([]);
  });
});

describe('SC-15, BR-010-21: logs are counts only', () => {
  it('names no journey, owner or file in a warning', async () => {
    const logger = spyOnLogger();
    const { service, source, deletions } = build(noonOn('2032-03-16'));
    const bad = source.add('2027-03-15');
    source.failing.add(bad.journeyId);
    const other = source.add('2027-03-16');
    source.ignoreCutoff = true;
    source.add('2027-03-15');
    deletions.failures = 1;

    await service.purgeDue();

    const logged = logger.loggedText();
    expect(logged).not.toBe('');
    for (const secret of [bad.journeyId, bad.ownerId, other.journeyId, 'secret.pdf']) {
      expect(logged).not.toContain(secret);
    }
  });

  it('keeps hexId unique', () => {
    expect(hexId()).not.toBe(hexId());
  });
});
