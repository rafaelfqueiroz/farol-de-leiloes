// SPEC-002 BR-002-27: reads under a grant are logged before they are returned, one entry per record,
// and a log that cannot be written refuses the read (fail closed). SC-15: the failure logs no data.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessContext } from '../access/access-context.js';
import type { SupportRequestSource } from '../access/sources/support-request.source.js';
import type { UsersService } from '../users/users.service.js';
import {
  accessContextFactory,
  anAccessContext,
  fakeAccessSources,
} from '../../test/fakes/fake-access-sources.js';
import { FakeClock } from '../../test/fakes/fake-clock.js';
import { spyOnLogger } from '../../test/support/logger-spy.js';
import type {
  AdminAccessLogRepository,
  NewAdminAccessLogEntry,
} from './admin-access-log.repository.js';
import {
  AdminAccessLogUnavailableError,
  GrantReadLogger,
  ownedRecordRead,
} from './grant-read-logger.js';
import type {
  StoredGrant,
  SupportAccessGrantRepository,
} from './support-access-grant.repository.js';
import { type SupportGrantRead, SupportGrantService } from './support-grant.service.js';

const ADMIN = '64b7f0000000000000000a01';
const REQUESTER = '64b7f0000000000000000b01';
const REQUEST = '64b7f0000000000000000c01';
const GRANT = '64b7f0000000000000000e01';
const OFFICE = '64b7f0000000000000000d01';
const RECORD_1 = '64b7f0000000000000000f01';
const RECORD_2 = '64b7f0000000000000000f02';
const SECRET = 'marcador-dado-cliente';

class RecordingLog {
  entries: NewAdminAccessLogEntry[] = [];
  failWith: unknown = null;

  append(entries: readonly NewAdminAccessLogEntry[]): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.entries.push(...entries);
    return Promise.resolve();
  }
}

interface Row {
  _id: string;
  ownerType: 'office';
  ownerId: string;
  name: string;
}

const rows: Row[] = [
  { _id: RECORD_1, ownerType: 'office', ownerId: OFFICE, name: SECRET },
  { _id: RECORD_2, ownerType: 'office', ownerId: OFFICE, name: 'second' },
];

/** A real SupportGrantRead, from the real service over one stored open grant. */
async function aGrantRead(clock: FakeClock): Promise<SupportGrantRead> {
  const grant: StoredGrant = {
    id: GRANT,
    supportRequestId: REQUEST,
    adminUserId: ADMIN,
    requesterUserId: REQUESTER,
    openedAt: clock.now(),
    expiresAt: new Date(clock.now().getTime() + 1000 * 60 * 60),
    status: 'open',
  };
  const service = new SupportGrantService(
    { findForAdmin: () => Promise.resolve(grant) } as unknown as SupportAccessGrantRepository,
    {
      findForGrant: () =>
        Promise.resolve({
          id: REQUEST,
          requesterUserId: REQUESTER,
          open: true,
          dataAccessAllowed: true,
        }),
    } satisfies SupportRequestSource,
    { findById: () => Promise.resolve({}) } as unknown as UsersService,
    accessContextFactory(fakeAccessSources({ memberships: [{ officeId: OFFICE }] })),
    clock,
  );
  return service.contextForRead(await anAccessContext(ADMIN, {}, true), GRANT);
}

afterEach(() => vi.restoreAllMocks());

describe('GrantReadLogger (BR-002-27)', () => {
  let log: RecordingLog;
  let clock: FakeClock;
  let logger: GrantReadLogger;
  let read: SupportGrantRead;

  beforeEach(async () => {
    log = new RecordingLog();
    clock = new FakeClock();
    logger = new GrantReadLogger(log as unknown as AdminAccessLogRepository, clock);
    read = await aGrantRead(clock);
  });

  const describeRow = ownedRecordRead('probe');

  it('logs one entry, with admin, grant, support request, owner, record and time', async () => {
    let seen: AccessContext | undefined;
    const record = await logger.readOne(
      read,
      (ctx) => {
        seen = ctx;
        return Promise.resolve(rows[0] ?? null);
      },
      describeRow,
    );

    expect(record).toBe(rows[0]);
    // The sealed view: the requester's, read-only, a grant view (BR-002-25).
    expect(seen).toMatchObject({ accountId: REQUESTER, readOnly: true, viaSupportGrant: true });
    expect(log.entries).toEqual([
      {
        adminUserId: ADMIN,
        action: 'grant_read',
        grantId: GRANT,
        supportRequestId: REQUEST,
        owner: { type: 'office', id: OFFICE },
        resource: { type: 'probe', id: RECORD_1 },
        at: clock.now(),
      },
    ]);
  });

  it('logs nothing when the record is not there (nothing was read)', async () => {
    expect(await logger.readOne(read, () => Promise.resolve(null), describeRow)).toBeNull();
    expect(log.entries).toEqual([]);
  });

  it('logs one entry per record of a list, in one append', async () => {
    const appended = vi.spyOn(log, 'append');

    expect(await logger.readMany(read, () => Promise.resolve(rows), describeRow)).toEqual(rows);

    expect(appended).toHaveBeenCalledTimes(1);
    expect(log.entries.map((entry) => entry.resource)).toEqual([
      { type: 'probe', id: RECORD_1 },
      { type: 'probe', id: RECORD_2 },
    ]);
  });

  it('refuses the read when the entry cannot be written, and logs no data (SC-15)', async () => {
    const spy = spyOnLogger();
    log.failWith = Object.assign(new Error(`E11000 duplicate key: ${SECRET}`), { code: 11000 });

    await expect(
      logger.readOne(read, () => Promise.resolve(rows[0] ?? null), describeRow),
    ).rejects.toBeInstanceOf(AdminAccessLogUnavailableError);
    await expect(logger.readMany(read, () => Promise.resolve(rows), describeRow)).rejects.toThrow(
      'BR-002-27',
    );

    expect(spy.loggedText()).toContain('11000');
    expect(spy.loggedText()).not.toContain(SECRET);
  });

  it('logs only a read the service validated', async () => {
    const forged = { ...read } as SupportGrantRead;
    await expect(logger.logRead(forged, describeRow(rows[0] as Row))).rejects.toThrow(
      'contextForRead',
    );
    expect(log.entries).toEqual([]);
  });

  it('reads only with a read the service built: a forged one never reaches the load', async () => {
    const load = vi.fn(() => Promise.resolve(rows));
    const copied = { ...read } as SupportGrantRead;
    // Even an object of the right class holds no sealed view unless the service built it.
    const prototyped = Object.create(read.constructor.prototype as object) as SupportGrantRead;

    for (const forged of [copied, prototyped]) {
      await expect(logger.readMany(forged, load, describeRow)).rejects.toThrow('contextForRead');
      await expect(
        logger.readOne(forged, () => load().then(() => null), describeRow),
      ).rejects.toThrow('contextForRead');
    }
    expect(load).not.toHaveBeenCalled();
    expect(log.entries).toEqual([]);
  });
});
