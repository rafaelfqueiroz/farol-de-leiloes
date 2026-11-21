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
import {
  FakeLegalValidationsRepository,
  FakeRetentionDeletionsRepository,
} from '../../../test/fakes/fake-privacy-repositories.js';
import { UNVALIDATED_RUN_CAP } from '../domain/retention.js';
import { testBusinessConfig } from '../../../test/support/test-env.js';
import {
  RETENTION_BATCH_SIZE,
  RETENTION_LOG_ATTEMPTS,
  RetentionService,
  RETENTION_MAX_BATCHES,
} from './retention.service.js';

/** Noon in Brasília (15:00 UTC, Brasília is UTC-3 in these years) of the given day. */
const noonOn = (date: string) => new Date(`${date}T15:00:00.000Z`);

/**
 * By default the retention period is validated for the setting (a record naming the same years), so
 * the safety brake is off; the brake has its own describe below.
 */
function build(now: Date, env: Record<string, string> = {}, reviewed: number | null = 5) {
  const clock = new FakeClock(now);
  const source = new FakeClosedJourneyFilesSource();
  const deletions = new FakeRetentionDeletionsRepository();
  const validations = new FakeLegalValidationsRepository();
  if (reviewed !== null) {
    void validations.insert({
      scope: 'retention-periods',
      validatedAt: new Date('2026-01-01T00:00:00.000Z'),
      validatorName: 'Dra. Teste',
      documentVersions: [],
      retentionYears: reviewed,
    });
  }
  const service = new RetentionService(
    source,
    deletions as never,
    validations as never,
    clock,
    testBusinessConfig(env),
  );
  return { service, source, deletions, validations, clock };
}

/** Fixed-width helper: a journey that is due on 2032-03-16 with 5 years (closed 2027-03-15). */

describe('BR-010-19: kept through the anniversary, deleted from the next day', () => {
  it('15/03/2027 is present on 15/03/2032 and gone on 16/03/2032', async () => {
    const { service, source, deletions, clock } = build(noonOn('2032-03-15'));
    source.add('2027-03-15', { files: 4 });

    expect(await service.purgeDue()).toMatchObject({
      deleted: 0,
      files: 0,
      outOfContract: 0,
      failed: 0,
    });
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
    expect(source.listed).toEqual([
      { cutoff: '2028-03-01', limit: RETENTION_BATCH_SIZE, excluded: 0 },
    ]);
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

    expect(await service.purgeDue()).toMatchObject({ deleted: 0, outOfContract: 1, failed: 0 });
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

    expect(await service.purgeDue()).toMatchObject({ deleted: 1, outOfContract: 1 });
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

  it('repairs a crash between the deletion and the log row: the journey stays listed, the repeat writes the row', async () => {
    const { service, source, deletions } = build(noonOn('2032-03-16'));
    const journey = source.add('2027-03-15', { files: 5 });
    // The files go, the row cannot be written (the process dies, or the database is down).
    deletions.failures = RETENTION_LOG_ATTEMPTS;
    expect(await service.purgeDue()).toMatchObject({ deleted: 0, failed: 1, unrecorded: 1 });
    expect(deletions.rows).toEqual([]);
    expect(source.acknowledged).toEqual([]);
    expect(journey.purged).toBe(false); // still listed: the contract keeps it until acknowledged

    // Next run: the source lists it again, the repeat deletes nothing (0), the row is written, the
    // journey is acknowledged. The logged count undercounts what the first call deleted: accepted.
    expect(await service.purgeDue()).toMatchObject({ deleted: 1, files: 0, failed: 0 });
    expect(deletions.rows).toHaveLength(1);
    expect(deletions.rows[0]).toMatchObject({ fileCount: 0 });
    expect(source.acknowledged).toEqual([journey.journeyId]);
    expect(await service.purgeDue()).toMatchObject({ deleted: 0 });
  });

  it('repairs a crash between the row and the acknowledgement: the duplicate row is success', async () => {
    const { service, source, deletions } = build(noonOn('2032-03-16'));
    const journey = source.add('2027-03-15', { files: 5 });
    source.failingAcknowledge.add(journey.journeyId);

    // The row exists, the source did not take the acknowledgement: reported, kept listed.
    expect(await service.purgeDue()).toMatchObject({ deleted: 1, files: 5, failed: 1 });
    expect(deletions.rows).toHaveLength(1);
    expect(journey.purged).toBe(false);

    source.failingAcknowledge.clear();
    expect(await service.purgeDue()).toMatchObject({ deleted: 1, files: 0, failed: 0 });
    expect(deletions.rows).toHaveLength(1); // still one row, with the first call's count
    expect(deletions.rows[0]).toMatchObject({ fileCount: 5 });
    expect(source.acknowledged).toEqual([journey.journeyId]);
  });

  it('acknowledges only after the row exists, and never a journey it did not delete', async () => {
    const { service, source, deletions } = build(noonOn('2032-03-16'));
    const order: string[] = [];
    const ack = source.acknowledgePurged.bind(source);
    source.acknowledgePurged = (id) => {
      order.push(`ack:${deletions.rows.length}`);
      return ack(id);
    };
    source.add('2027-03-15');
    source.add('2031-01-01'); // not due
    source.ignoreCutoff = true;

    await service.purgeDue();

    expect(order).toEqual(['ack:1']);
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

  it('does not let a head of failing journeys hide the ones behind it (excluded from the next listing)', async () => {
    const { service, source } = build(noonOn('2032-03-16'));
    for (let i = 0; i < RETENTION_BATCH_SIZE + 5; i += 1) {
      source.failing.add(source.add('2027-03-01').journeyId);
    }
    const good = source.add('2027-03-15', { files: 2 });

    const outcome = await service.purgeDue();

    expect(outcome).toMatchObject({ deleted: 1, files: 2, failed: RETENTION_BATCH_SIZE + 5 });
    expect(source.journeys.find((j) => j.journeyId === good.journeyId)?.purged).toBe(true);
    // Each failing journey was tried once, and the listings were told whom to leave out.
    expect(source.purgeCalls).toHaveLength(RETENTION_BATCH_SIZE + 6);
    expect(source.listed[0]?.excluded).toBe(0);
    expect(source.listed[1]?.excluded).toBe(RETENTION_BATCH_SIZE);
  });

  it('stops when a source ignores the exclusion and offers only journeys already handled', async () => {
    const { service, source } = build(noonOn('2032-03-16'));
    const bad = source.add('2027-03-15');
    source.failing.add(bad.journeyId);
    source.listClosedJourneys = (cutoff, limit) => {
      source.listed.push({ cutoff, limit, excluded: 0 });
      const { journeyId, ownerType, ownerId, closedOn, closedKind } = bad;
      return Promise.resolve(
        Array.from({ length: limit }, () => ({
          journeyId,
          ownerType,
          ownerId,
          closedOn,
          closedKind,
        })),
      );
    };

    expect(await service.purgeDue()).toMatchObject({ deleted: 0, failed: 1 });
    expect(source.listed.length).toBeLessThanOrEqual(2);
  });

  it('is bounded: never more listings than RETENTION_MAX_BATCHES', async () => {
    const { service, source } = build(noonOn('2032-03-16'));
    let n = 0;
    source.listClosedJourneys = (cutoff, limit) => {
      source.listed.push({ cutoff, limit, excluded: 0 });
      return Promise.resolve(
        Array.from({ length: limit }, () => ({
          journeyId: (++n).toString(16).padStart(24, '0'),
          ownerType: 'office',
          ownerId: '0'.repeat(24),
          closedOn: '2027-03-15',
          closedKind: 'won' as const,
        })),
      );
    };

    await service.purgeDue();

    expect(source.listed).toHaveLength(RETENTION_MAX_BATCHES);
  });

  it('lists nothing and does nothing with the default source (before SPEC-017)', async () => {
    const { service, source } = build(noonOn('2032-03-16'));
    expect(await service.purgeDue()).toEqual({
      deleted: 0,
      files: 0,
      outOfContract: 0,
      failed: 0,
      unrecorded: 0,
      capped: false,
      review: 'validated',
    });
    expect(source.purgeCalls).toEqual([]);
  });
});

describe('the contract is enforced, not trusted: a candidate outside it is never purged', () => {
  it.each([
    ['an unknown closing kind', { closedOn: '2027-03-15', kind: 'in_progress' }],
    ['0000-01-01', { closedOn: '0000-01-01' }],
    ['1970-01-01', { closedOn: '1970-01-01' }],
    ['a closing date in the future', { closedOn: '2032-03-17' }],
  ])('%s', async (_label, bad) => {
    const logger = spyOnLogger();
    const { service, source, deletions } = build(noonOn('2032-03-16'));
    source.ignoreCutoff = true;
    const journey = source.add(bad.closedOn, { kind: (bad as { kind?: string }).kind as never });
    const fine = source.add('2027-03-15');

    expect(await service.purgeDue()).toMatchObject({ deleted: 1, outOfContract: 1, failed: 0 });

    expect(source.purgeCalls).toEqual([fine.journeyId]);
    expect(deletions.rows.map((row) => row.journeyId)).toEqual([fine.journeyId]);
    expect(journey.purged).toBe(false);
    // The journey's id, so the source's defect can be found; nothing else about it.
    expect(logger.loggedText()).toContain(journey.journeyId);
    expect(logger.loggedText()).not.toContain(journey.ownerId);
  });
});

describe('BR-010-24: lowering the period is braked until the lawyer validated it', () => {
  /** n journeys closed in 2027, due on 2032-03-16 with 5 years but not with 6. */
  const addDue = (source: FakeClosedJourneyFilesSource, n: number) => {
    for (let i = 0; i < n; i += 1) source.add('2027-03-15', { files: 1 });
  };

  it('lowering 6 -> 5 after a validation of 6: the journeys in between become due, the run is capped and warns', async () => {
    const logger = spyOnLogger();
    const { service, source, deletions } = build(
      noonOn('2032-03-16'),
      { DOCUMENT_RETENTION_YEARS: '5' },
      6,
    );
    addDue(source, UNVALIDATED_RUN_CAP + 10);

    const outcome = await service.purgeDue();

    expect(outcome).toMatchObject({
      deleted: UNVALIDATED_RUN_CAP,
      capped: true,
      review: 'lowered',
    });
    expect(deletions.rows).toHaveLength(UNVALIDATED_RUN_CAP);
    expect(logger.loggedText()).toContain('shorter than the period the lawyer validated');
    // Tomorrow's run takes the next 25: nothing is lost by the cap, only slowed down.
    expect(await service.purgeDue()).toMatchObject({ deleted: 10, capped: false });
  });

  it('raising 5 -> 6 deletes nothing extra and is not braked', async () => {
    const five = build(noonOn('2032-03-16'), { DOCUMENT_RETENTION_YEARS: '5' }, 5);
    addDue(five.source, 30);
    expect(await five.service.purgeDue()).toMatchObject({ deleted: 30, capped: false });

    const six = build(noonOn('2032-03-16'), { DOCUMENT_RETENTION_YEARS: '6' }, 5);
    addDue(six.source, 30);
    expect(await six.service.purgeDue()).toMatchObject({
      deleted: 0,
      capped: false,
      review: 'validated',
    });
    expect(six.source.purgeCalls).toEqual([]);
  });

  it('with no validation (provisional) the run is capped too, and warns', async () => {
    const logger = spyOnLogger();
    const { service, source } = build(noonOn('2032-03-16'), {}, null);
    addDue(source, UNVALIDATED_RUN_CAP + 1);

    expect(await service.purgeDue()).toMatchObject({
      deleted: UNVALIDATED_RUN_CAP,
      capped: true,
      review: 'provisional',
    });
    expect(logger.loggedText()).toContain('not validated yet (provisional)');
  });

  it('a validation that noted no period does not brake', async () => {
    const { service, source, validations } = build(noonOn('2032-03-16'), {}, null);
    await validations.insert({
      scope: 'retention-periods',
      validatedAt: new Date('2026-01-01T00:00:00.000Z'),
      validatorName: 'Dra. Teste',
      documentVersions: [],
    });
    addDue(source, UNVALIDATED_RUN_CAP + 1);

    expect(await service.purgeDue()).toMatchObject({
      deleted: UNVALIDATED_RUN_CAP + 1,
      capped: false,
    });
  });

  it('the NEWEST validation decides: a later review of 5 lifts the brake a validation of 6 set', async () => {
    const { service, source, validations } = build(
      noonOn('2032-03-16'),
      { DOCUMENT_RETENTION_YEARS: '5' },
      6,
    );
    await validations.insert({
      scope: 'retention-periods',
      validatedAt: new Date('2026-06-01T00:00:00.000Z'),
      validatorName: 'Dra. Teste',
      documentVersions: [],
      retentionYears: 5,
    });
    addDue(source, UNVALIDATED_RUN_CAP + 1);

    expect(await service.purgeDue()).toMatchObject({
      deleted: UNVALIDATED_RUN_CAP + 1,
      capped: false,
    });
  });

  it('treats a validation that cannot be read as unvalidated, never as safe', async () => {
    const logger = spyOnLogger();
    const { service, source, validations } = build(noonOn('2032-03-16'));
    validations.failReadsWith = new TypeError('quotes mongodb://secret@host');
    addDue(source, UNVALIDATED_RUN_CAP + 1);

    expect(await service.purgeDue()).toMatchObject({ capped: true, review: 'provisional' });
    expect(logger.loggedText()).toContain('TypeError');
    expect(logger.loggedText()).not.toContain('secret');
  });

  it('a run with nothing due does not warn', async () => {
    const logger = spyOnLogger();
    const { service } = build(noonOn('2032-03-16'), {}, null);

    await service.purgeDue();

    expect(logger.loggedText()).not.toContain('provisional');
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
