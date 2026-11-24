// SPEC-009 BR-009-04, BR-009-06, BR-009-08, BR-009-09 (requester side) over in-memory fakes; the
// conditional updates and the races are proven against MongoDB in test/integration/support-requests.spec.ts.
// Fake values only (TS-27); expected protocols are computed by hand (TS-04).
import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { anAccessContext } from '../../test/fakes/fake-access-sources.js';
import { FakeClock, HOUR } from '../../test/fakes/fake-clock.js';
import { FakeEmailSender } from '../../test/fakes/fake-email-sender.js';
import { FakeSupportRequestsRepository } from '../../test/fakes/fake-support-requests-repository.js';
import { testConfigService } from '../../test/support/test-env.js';
import type { SupportGrantService } from '../admin-access/support-grant.service.js';
import { DomainError } from '../common/errors/domain-error.js';
import type { EmailService } from '../email/email.service.js';
import type { UsersService } from '../users/users.service.js';
import type { SupportCountersRepository } from './support-counters.repository.js';
import { SupportMailService } from './support-mail.service.js';
import { SupportService } from './support.service.js';

const OWNER = '64b7f0000000000000000011';
const OTHER = '64b7f0000000000000000012';

async function setup(now = new Date('2099-01-15T12:00:00.000Z')) {
  const requests = new FakeSupportRequestsRepository();
  const clock = new FakeClock(now);
  const mailbox = new FakeEmailSender();
  const config = testConfigService() as unknown as ConfigService<never, true>;
  const keys: string[] = [];
  const sequences = new Map<string, number>();
  const counters = {
    next: (key: string) => {
      keys.push(key);
      const next = (sequences.get(key) ?? 0) + 1;
      sequences.set(key, next);
      return Promise.resolve(next);
    },
  } as unknown as SupportCountersRepository;
  const endedFor: Array<[string, string]> = [];
  const grants = {
    endForSupportRequest: (id: string, reason: string) => {
      endedFor.push([id, reason]);
      return Promise.resolve(false);
    },
  } as unknown as SupportGrantService;
  const mail = new SupportMailService(
    requests as never,
    {
      findById: vi
        .fn()
        .mockResolvedValue({ name: 'Fulana', email: 'f@example.test', status: 'active' }),
    } as unknown as UsersService,
    mailbox as unknown as EmailService,
    config,
    clock,
  );
  const service = new SupportService(requests as never, counters, mail, grants, config, clock);
  return {
    service,
    requests,
    clock,
    keys,
    endedFor,
    mailbox,
    owner: await anAccessContext(OWNER),
    other: await anAccessContext(OTHER),
  };
}

const dto = (rest: { allowDataAccess?: boolean } = {}) => ({
  subject: 'Assunto ficticio',
  message: 'Mensagem ficticia de teste',
  allowDataAccess: rest.allowDataAccess ?? false,
});

describe('SupportService.contactEmail (BR-009-03)', () => {
  it('is the configured SUPPORT_EMAIL', async () => {
    expect((await setup()).service.contactEmail()).toBe('suporte-ficticio@example.test');
  });
});

describe('SupportService.create (BR-009-06)', () => {
  it('stores an open request with the protocol FL-<year>-<sequence>, numbered per year from 1', async () => {
    const { service, owner, keys } = await setup();

    const first = await service.create(owner, dto());
    const second = await service.create(owner, dto());

    expect(first.request.protocol).toBe('FL-2099-000001');
    expect(second.request.protocol).toBe('FL-2099-000002');
    expect(first.request.status).toBe('open');
    expect(first.request.allowDataAccess).toBe(false);
    expect(keys).toEqual(['support_protocol:2099', 'support_protocol:2099']);
  });

  it('BR-009-08: stores the permission only when it was given', async () => {
    const { service, owner } = await setup();

    expect(
      (await service.create(owner, dto({ allowDataAccess: true }))).request.allowDataAccess,
    ).toBe(true);
  });

  it('numbers by the YEAR IN BRASÍLIA TIME (AR-23): 22:00 on 31 December there is still that year, 03:30 UTC on 1 January there is the next', async () => {
    // 2100-01-01T01:00Z is 2099-12-31 22:00 in Brasília (UTC-3, no daylight time in 2099/2100).
    const { service, owner, clock, keys } = await setup(new Date('2100-01-01T01:00:00.000Z'));

    const lastOfYear = await service.create(owner, dto());
    clock.set(new Date('2100-01-01T03:30:00.000Z'));
    const firstOfYear = await service.create(owner, dto());

    expect(lastOfYear.request.protocol).toBe('FL-2099-000001');
    expect(firstOfYear.request.protocol).toBe('FL-2100-000001'); // the new year restarts the sequence
    expect(keys).toEqual(['support_protocol:2099', 'support_protocol:2100']);
  });

  it('BR-009-07: tries both emails at once and says whether the confirmation is out', async () => {
    const { service, owner, mailbox } = await setup();

    const created = await service.create(owner, dto());

    expect(created.confirmationSent).toBe(true);
    expect(mailbox.supportNotices).toHaveLength(1);
    expect(mailbox.supportConfirmations).toHaveLength(1);
  });

  it('BR-009-07: the request is stored and the protocol answered when the mail is down', async () => {
    const { service, owner, mailbox, requests } = await setup();
    mailbox.supportMailDown = true;

    const created = await service.create(owner, dto());

    expect(created.confirmationSent).toBe(false);
    expect(created.request.protocol).toBe('FL-2099-000001');
    expect(requests.rows).toHaveLength(1);
  });
});

describe('SupportService.listMine and getMine (BR-009-09, AR-14)', () => {
  it('lists the account’s own requests, newest first, paginated', async () => {
    const { service, owner, other } = await setup();
    await service.create(owner, dto());
    await service.create(owner, dto());
    await service.create(other, dto());

    const page = await service.listMine(owner, { page: 1, pageSize: 1 });

    expect(page).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(page.items.map((item) => item.protocol)).toEqual(['FL-2099-000002']);
  });

  it('gives an own request, and the same NOT_FOUND for another account’s, a missing and a malformed id', async () => {
    const { service, owner, other } = await setup();
    const { request } = await service.create(owner, dto());
    const id = request._id.toHexString();

    expect((await service.getMine(owner, id)).protocol).toBe('FL-2099-000001');
    const refusals = await Promise.all(
      [id, '64b7f00000000000000ffff1', 'not-an-id'].map((target) =>
        service.getMine(other, target).catch((error: unknown) => error),
      ),
    );
    for (const refusal of refusals) {
      expect(refusal).toBeInstanceOf(DomainError);
      expect(refusal).toMatchObject({ code: 'NOT_FOUND', context: {} });
    }
  });
});

describe('SupportService.withdrawDataAccess (BR-009-08, BR-002-26)', () => {
  it('records the withdrawal at the Clock time and ends the open grant of the request', async () => {
    const { service, owner, endedFor, clock } = await setup();
    const { request } = await service.create(owner, dto({ allowDataAccess: true }));
    clock.advance(HOUR);

    const after = await service.withdrawDataAccess(owner, request._id.toHexString());

    expect(after.dataAccessWithdrawnAt).toEqual(new Date('2099-01-15T13:00:00.000Z'));
    expect(endedFor).toEqual([[request._id.toHexString(), 'withdrawn']]);
  });

  it('is idempotent: asking again keeps the first withdrawal time and answers the same request', async () => {
    const { service, owner, clock } = await setup();
    const { request } = await service.create(owner, dto({ allowDataAccess: true }));
    const id = request._id.toHexString();
    clock.advance(HOUR);
    const first = await service.withdrawDataAccess(owner, id);
    clock.advance(HOUR);

    const second = await service.withdrawDataAccess(owner, id);

    expect(second.dataAccessWithdrawnAt).toEqual(first.dataAccessWithdrawnAt);
  });

  it('answers the unchanged request, with no error, when the permission was never given', async () => {
    const { service, owner, endedFor } = await setup();
    const { request } = await service.create(owner, dto());

    const after = await service.withdrawDataAccess(owner, request._id.toHexString());

    expect(after.dataAccessWithdrawnAt).toBeUndefined();
    expect(endedFor).toHaveLength(1); // a grant a race left open is ended anyway
  });

  it('refuses a closed request with SUPPORT_REQUEST_CLOSED and leaves it alone', async () => {
    const { service, owner, requests, endedFor } = await setup();
    const { request } = await service.create(owner, dto({ allowDataAccess: true }));
    const row = requests.rows[0];
    if (row) row.status = 'closed';

    await expect(
      service.withdrawDataAccess(owner, request._id.toHexString()),
    ).rejects.toMatchObject({
      code: 'SUPPORT_REQUEST_CLOSED',
    });

    expect(row?.dataAccessWithdrawnAt).toBeUndefined();
    expect(endedFor).toEqual([]);
  });

  it('BR-009-12: a close that lands between the read and the conditional write makes the withdrawal SUPPORT_REQUEST_CLOSED, records nothing and still ends the grant', async () => {
    const { service, owner, requests, endedFor } = await setup();
    const { request } = await service.create(owner, dto({ allowDataAccess: true }));
    const id = request._id.toHexString();
    const write = requests.markDataAccessWithdrawn;
    requests.markDataAccessWithdrawn = (ctx, requestId, at) => {
      const row = requests.rows[0];
      if (row) row.status = 'closed'; // the admin's close, between the service's read and its write
      return write(ctx, requestId, at);
    };

    await expect(service.withdrawDataAccess(owner, id)).rejects.toMatchObject({
      code: 'SUPPORT_REQUEST_CLOSED',
    });

    expect(requests.rows[0]?.dataAccessWithdrawnAt).toBeUndefined();
    expect(endedFor).toEqual([[id, 'withdrawn']]);
  });

  it('a withdrawal that loses to ANOTHER withdrawal of the same request still answers the request, withdrawn once', async () => {
    const { service, owner, requests, clock } = await setup();
    const { request } = await service.create(owner, dto({ allowDataAccess: true }));
    const id = request._id.toHexString();
    const at = new Date(clock.now().getTime());
    const write = requests.markDataAccessWithdrawn;
    requests.markDataAccessWithdrawn = (ctx, requestId, when) => {
      const row = requests.rows[0];
      if (row) row.dataAccessWithdrawnAt = at; // the other tab's withdrawal got there first
      return write(ctx, requestId, when);
    };

    const after = await service.withdrawDataAccess(owner, id);

    expect(after.dataAccessWithdrawnAt).toEqual(at);
    expect(after.status).toBe('open');
  });

  it('answers NOT_FOUND, and ends nothing, for another account’s request (AR-14)', async () => {
    const { service, owner, other, requests, endedFor } = await setup();
    const { request } = await service.create(owner, dto({ allowDataAccess: true }));

    await expect(
      service.withdrawDataAccess(other, request._id.toHexString()),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    expect(requests.rows[0]?.dataAccessWithdrawnAt).toBeUndefined();
    expect(endedFor).toEqual([]);
  });
});
