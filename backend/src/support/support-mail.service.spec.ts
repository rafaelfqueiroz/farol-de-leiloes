// SPEC-009 BR-009-07, BR-009-10, BR-009-15: the outbox orchestration over an in-memory repository (the
// conditional updates themselves are proven against MongoDB in test/integration/support-requests.spec.ts).
// Fake names, addresses and texts only (TS-27); expectations are the schedule of domain/mail-outbox.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { anAccessContext } from '../../test/fakes/fake-access-sources.js';
import { FakeClock, MINUTE } from '../../test/fakes/fake-clock.js';
import { FakeEmailSender } from '../../test/fakes/fake-email-sender.js';
import { FakeSupportRequestsRepository } from '../../test/fakes/fake-support-requests-repository.js';
import { expectNoneLogged, spyOnLogger } from '../../test/support/logger-spy.js';
import { testConfigService } from '../../test/support/test-env.js';
import type { EmailService } from '../email/email.service.js';
import type { UsersService } from '../users/users.service.js';
import { SupportMailService } from './support-mail.service.js';

const USER_ID = '64b7f0000000000000000011';
const REQUESTER = { name: 'Fulana Ficticia', email: 'fulana.ficticia@example.test' };

afterEach(() => vi.restoreAllMocks());

/** Just what SupportMailService reads of UsersService: the account by id, with its status. */
function usersWith(account: { name: string; email: string; status?: string } | null) {
  return {
    findById: vi.fn().mockResolvedValue(account),
  } as unknown as UsersService;
}

async function setup(
  account: Parameters<typeof usersWith>[0] = { ...REQUESTER, status: 'active' },
) {
  const repo = new FakeSupportRequestsRepository();
  const clock = new FakeClock(new Date('2099-01-15T12:00:00.000Z'));
  const mailbox = new FakeEmailSender();
  const users = usersWith(account);
  const mail = new SupportMailService(
    repo as never,
    users,
    mailbox as unknown as EmailService,
    testConfigService() as unknown as ConfigService<never, true>,
    clock,
  );
  const ctx = await anAccessContext(USER_ID);
  const request = await repo.createFor(ctx, {
    protocol: 'FL-2099-000001',
    subject: 'Assunto ficticio',
    message: 'Mensagem ficticia de teste',
    allowDataAccess: false,
    openedAt: clock.now(),
  });
  return { repo, clock, mailbox, users, mail, id: request._id.toHexString() };
}

describe('SupportMailService.deliverNow (BR-009-07, BR-009-10)', () => {
  it('sends the notice to SUPPORT_EMAIL and the confirmation to the account, then owes nothing', async () => {
    const { mail, mailbox, repo, id } = await setup();

    await expect(mail.deliverNow(id)).resolves.toEqual({ confirmationSent: true });

    expect(mailbox.supportNotices).toEqual([
      {
        to: 'suporte-ficticio@example.test',
        protocol: 'FL-2099-000001',
        requesterName: REQUESTER.name,
        requesterEmail: REQUESTER.email,
        subject: 'Assunto ficticio',
        message: 'Mensagem ficticia de teste',
      },
    ]);
    expect(mailbox.supportConfirmations).toEqual([
      {
        to: REQUESTER.email,
        requestId: id,
        protocol: 'FL-2099-000001',
        subject: 'Assunto ficticio',
        message: 'Mensagem ficticia de teste',
      },
    ]);
    const row = repo.rows[0];
    expect(row?.confirmationSentAt).toEqual(new Date('2099-01-15T12:00:00.000Z'));
    expect(row?.teamNoticeSentAt).toEqual(new Date('2099-01-15T12:00:00.000Z'));
    expect(row?.mailNextAttemptAt).toBeUndefined();
    expect(row?.mailClaimToken).toBeUndefined();
  });

  it('BR-009-07: a failed send is not an error: confirmationSent false and a retry in 1 minute', async () => {
    const { mail, mailbox, repo, id } = await setup();
    mailbox.supportMailDown = true;

    await expect(mail.deliverNow(id)).resolves.toEqual({ confirmationSent: false });

    expect(repo.rows[0]).toMatchObject({
      mailAttempts: 1,
      mailNextAttemptAt: new Date('2099-01-15T12:01:00.000Z'),
    });
    expect(repo.rows[0]?.mailClaimToken).toBeUndefined();
    expect(mailbox.supportNotices).toEqual([]);
  });

  it('does not send what is already sent: the repeat round only sends what failed', async () => {
    const { mail, mailbox, clock, id } = await setup();
    mailbox.failFor.add(REQUESTER.email); // only the confirmation fails

    await expect(mail.deliverNow(id)).resolves.toEqual({ confirmationSent: false });
    expect(mailbox.supportNotices).toHaveLength(1);

    mailbox.failFor.clear();
    clock.advance(MINUTE);
    await expect(mail.processDue()).resolves.toMatchObject({ requests: 1, sent: 1 });

    expect(mailbox.supportNotices).toHaveLength(1); // not repeated
    expect(mailbox.supportConfirmations).toHaveLength(1);
  });

  it('answers confirmationSent false, and sends nothing, when another sender holds the request', async () => {
    const { mail, mailbox, repo, clock, id } = await setup();
    await repo.claimDeliveryByJob(
      id,
      'other-token',
      clock.now(),
      new Date(clock.now().getTime() + 2 * MINUTE),
    );

    await expect(mail.deliverNow(id)).resolves.toEqual({ confirmationSent: false });

    expect(mailbox.supportNotices).toEqual([]);
    expect(mailbox.supportConfirmations).toEqual([]);
  });

  it('never throws, and logs the id and a code only, when the store itself fails', async () => {
    const logger = spyOnLogger();
    const { mail, repo, id } = await setup();
    vi.spyOn(repo, 'claimDeliveryByJob').mockRejectedValue(
      new Error(`boom ${REQUESTER.email} Mensagem ficticia`),
    );

    await expect(mail.deliverNow(id)).resolves.toEqual({ confirmationSent: false });

    expectNoneLogged(logger.loggedText(), [REQUESTER.email, 'Mensagem ficticia', 'boom']);
    expect(logger.loggedText()).toContain(id);
  });
});

describe('the requester at delivery time (BR-009-07, BR-009-15)', () => {
  it('BR-009-07: sends to the CURRENT address of the account, not one copied when the request was made', async () => {
    const { mail, mailbox, users, id } = await setup();
    (users.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
      name: 'Fulana Nova',
      email: 'fulana.nova@example.test',
      status: 'active',
    });

    await mail.deliverNow(id);

    expect(mailbox.supportConfirmations.map((sent) => sent.to)).toEqual([
      'fulana.nova@example.test',
    ]);
    expect(mailbox.supportNotices[0]).toMatchObject({
      requesterName: 'Fulana Nova',
      requesterEmail: 'fulana.nova@example.test',
    });
  });

  it('BR-009-15: a deactivated account gets no confirmation, the team still gets the notice, nothing is retried', async () => {
    const { mail, mailbox, repo, id } = await setup({ ...REQUESTER, status: 'deactivated' });

    await expect(mail.deliverNow(id)).resolves.toEqual({ confirmationSent: false });

    expect(mailbox.supportConfirmations).toEqual([]);
    expect(mailbox.supportNotices).toHaveLength(1);
    expect(repo.rows[0]?.confirmationSkippedAt).toBeDefined();
    expect(repo.rows[0]?.mailNextAttemptAt).toBeUndefined();
  });

  it('an account with no status is active (a legacy document)', async () => {
    const { mail, mailbox, id } = await setup(REQUESTER);

    await expect(mail.deliverNow(id)).resolves.toEqual({ confirmationSent: true });
    expect(mailbox.supportNotices).toHaveLength(1);
  });

  it.each([['closed'], [null]])(
    'a %s account: neither mail is sent, both are skipped',
    async (status) => {
      const account = status === null ? null : { ...REQUESTER, status };
      const { mail, mailbox, repo, id } = await setup(account);

      await mail.deliverNow(id);

      expect(mailbox.supportConfirmations).toEqual([]);
      expect(mailbox.supportNotices).toEqual([]);
      expect(repo.rows[0]?.teamNoticeSkippedAt).toBeDefined();
      expect(repo.rows[0]?.confirmationSkippedAt).toBeDefined();
      expect(repo.rows[0]?.mailNextAttemptAt).toBeUndefined();
    },
  );
});

describe('SupportMailService.processDue (the job)', () => {
  it('waits out the backoff: nothing is due before the retry time, one delivery at it', async () => {
    const { mail, mailbox, clock, id } = await setup();
    mailbox.supportMailDown = true;
    await mail.deliverNow(id);
    mailbox.supportMailDown = false;

    clock.advance(MINUTE - 1);
    await expect(mail.processDue()).resolves.toEqual({
      requests: 0,
      sent: 0,
      retried: 0,
      gaveUp: 0,
    });
    clock.advance(1);
    await expect(mail.processDue()).resolves.toEqual({
      requests: 1,
      sent: 2,
      retried: 0,
      gaveUp: 0,
    });

    expect(mailbox.supportConfirmations).toHaveLength(1);
    expect(mailbox.supportNotices).toHaveLength(1);
    // A second run finds nothing owed.
    await expect(mail.processDue()).resolves.toEqual({
      requests: 0,
      sent: 0,
      retried: 0,
      gaveUp: 0,
    });
    expect(mailbox.supportConfirmations).toHaveLength(1);
  });

  it('BR-009-07: grows the wait 1, 2, 5, 15, 60, 180, 180 minutes, then gives up at the eighth failure, once, with ids only', async () => {
    const logger = spyOnLogger();
    const { mail, mailbox, repo, clock, id } = await setup();
    mailbox.supportMailDown = true;
    await mail.deliverNow(id); // the first failed round

    const waits: number[] = [];
    for (let round = 2; round <= 7; round += 1) {
      const before = clock.now().getTime();
      const due = repo.rows[0]?.mailNextAttemptAt?.getTime() ?? before;
      waits.push((due - before) / MINUTE);
      clock.set(new Date(due));
      await mail.processDue();
    }
    waits.push(
      ((repo.rows[0]?.mailNextAttemptAt?.getTime() ?? 0) - clock.now().getTime()) / MINUTE,
    );
    // Rounds 1..7 have failed: the waits after each were 1, 2, 5, 15, 60, 180, 180.
    expect(waits).toEqual([1, 2, 5, 15, 60, 180, 180]);

    clock.set(repo.rows[0]?.mailNextAttemptAt ?? clock.now());
    await expect(mail.processDue()).resolves.toEqual({
      requests: 1,
      sent: 0,
      retried: 0,
      gaveUp: 1,
    });
    expect(repo.rows[0]).toMatchObject({ mailAttempts: 8, mailGaveUpAt: clock.now() });
    expect(repo.rows[0]?.mailNextAttemptAt).toBeUndefined();

    clock.advance(24 * 60 * MINUTE);
    await expect(mail.processDue()).resolves.toEqual({
      requests: 0,
      sent: 0,
      retried: 0,
      gaveUp: 0,
    });
    expect(logger.loggedText()).toContain(
      `Support mail for request ${id} gave up after 8 failed rounds`,
    );
    expectNoneLogged(logger.loggedText(), [
      REQUESTER.email,
      REQUESTER.name,
      'Mensagem ficticia',
      'Assunto ficticio',
    ]);
  });

  it('takes at most `limit` requests a run, oldest due first', async () => {
    const { mail, repo, mailbox, clock } = await setup();
    const ctx = await anAccessContext('64b7f0000000000000000012');
    for (const n of [2, 3]) {
      await repo.createFor(ctx, {
        protocol: `FL-2099-00000${n}`,
        subject: 'Assunto ficticio',
        message: 'Mensagem ficticia de teste',
        allowDataAccess: false,
        openedAt: clock.now(),
      });
    }

    await expect(mail.processDue(2)).resolves.toMatchObject({ requests: 2, sent: 4 });
    await expect(mail.processDue(2)).resolves.toMatchObject({ requests: 1, sent: 2 });
    expect(mailbox.supportNotices.map((sent) => sent.protocol).sort()).toEqual([
      'FL-2099-000001',
      'FL-2099-000002',
      'FL-2099-000003',
    ]);
  });

  it('two runs at once on one request send once: the claim gives it to one of them', async () => {
    const { mail, mailbox } = await setup();

    const [a, b] = await Promise.all([mail.processDue(), mail.processDue()]);

    expect(a.requests + b.requests).toBe(1);
    expect(mailbox.supportNotices).toHaveLength(1);
    expect(mailbox.supportConfirmations).toHaveLength(1);
  });
});

describe('a slow SMTP server against the claim lease (BR-009-07, review finding 1)', () => {
  // Hand-computed: the lease is 2 minutes; one send may take 20 s; the request that creates a support
  // request waits 6 s for its own delivery at most.
  const SEND_TIMEOUT_MS = 20_000;
  const INLINE_BUDGET_MS = 6_000;

  afterEach(() => vi.useRealTimers());

  it('a send that outlives the lease is taken over by another worker: each mail is delivered once and the first worker clobbers nothing', async () => {
    const { mail, mailbox, repo, clock, id } = await setup();
    const stalled = mailbox.holdNextSupportSend(); // the first worker's notice hangs
    const first = mail.deliverNow(id);
    await vi.waitFor(() => expect(mailbox.waitingSupportSends).toBe(1));

    clock.advance(3 * MINUTE); // its 2-minute lease ran out; a second worker takes the request
    await expect(mail.processDue()).resolves.toMatchObject({ requests: 1, sent: 2 });
    stalled.fail(); // the first worker's transport finally gives up
    await first;

    expect(mailbox.supportNotices).toHaveLength(1);
    expect(mailbox.supportConfirmations).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({ mailAttempts: 0 });
    expect(repo.rows[0]?.teamNoticeSentAt).toBeDefined();
    expect(repo.rows[0]?.confirmationSentAt).toBeDefined();
    expect(repo.rows[0]?.mailNextAttemptAt).toBeUndefined(); // the first worker's release did not undo it
    expect(repo.rows[0]?.mailClaimToken).toBeUndefined();
  });

  it('a worker whose lease ended while it sent the first mail does not send the second, and hands the rest to the next run', async () => {
    const { mail, mailbox, repo, clock, id } = await setup();
    const slow = mailbox.holdNextSupportSend();
    const first = mail.deliverNow(id);
    await vi.waitFor(() => expect(mailbox.waitingSupportSends).toBe(1));

    clock.advance(3 * MINUTE); // nobody has taken over yet, but the lease is over
    slow.succeed();
    await first;

    expect(mailbox.supportNotices).toHaveLength(1);
    expect(mailbox.supportConfirmations).toHaveLength(0); // not sent on a lease it no longer holds
    expect(repo.rows[0]?.mailClaimToken).toBeUndefined();

    await mail.processDue();
    expect(mailbox.supportNotices).toHaveLength(1); // the notice is not repeated
    expect(mailbox.supportConfirmations).toHaveLength(1);
  });

  it('answers the request at once when SMTP stalls: deliverNow returns within its budget with confirmationSent false', async () => {
    vi.useFakeTimers();
    const { mail, mailbox, repo, id } = await setup();
    const stalled = mailbox.holdNextSupportSend();

    const answer = mail.deliverNow(id);
    await vi.advanceTimersByTimeAsync(INLINE_BUDGET_MS);

    await expect(answer).resolves.toEqual({ confirmationSent: false });
    expect(repo.rows[0]?.mailClaimToken).toBeDefined(); // the delivery goes on in the background
    stalled.fail();
    await vi.waitFor(() => expect(repo.rows[0]?.mailClaimToken).toBeUndefined());
    expect(repo.rows[0]).toMatchObject({ mailAttempts: 1 }); // and a failed round is counted
  });

  it('gives up on one send after its time limit, far inside the lease, and retries the round', async () => {
    vi.useFakeTimers();
    const { mail, mailbox, repo } = await setup();
    mailbox.holdNextSupportSend(); // never answers

    const run = mail.processDue();
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    const outcome = await run;

    expect(outcome).toMatchObject({ requests: 1, retried: 1 });
    expect(repo.rows[0]).toMatchObject({ mailAttempts: 1 });
    expect(repo.rows[0]?.mailClaimToken).toBeUndefined();
    // The confirmation was still tried in the same round (the notice timed out, its own time not up).
    expect(mailbox.supportConfirmations).toHaveLength(1);
  });
});

describe('a fault outside the send (review finding 7)', () => {
  it('a failing account lookup counts as a failed round, and does not stop the run for the other requests', async () => {
    const { mail, mailbox, repo, users, clock } = await setup();
    const ctx = await anAccessContext('64b7f0000000000000000012');
    await repo.createFor(ctx, {
      protocol: 'FL-2099-000002',
      subject: 'Assunto ficticio',
      message: 'Mensagem ficticia de teste',
      allowDataAccess: false,
      openedAt: clock.now(),
    });
    (users.findById as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error(`db down ${REQUESTER.email}`))
      .mockResolvedValue({ ...REQUESTER, status: 'active' });

    const outcome = await mail.processDue();

    expect(outcome).toMatchObject({ requests: 2, retried: 1 });
    expect(repo.rows[0]).toMatchObject({ mailAttempts: 1 });
    expect(repo.rows[0]?.mailNextAttemptAt).toEqual(new Date(clock.now().getTime() + MINUTE));
    expect(repo.rows[1]?.teamNoticeSentAt).toBeDefined(); // the other request was delivered
    expect(mailbox.supportNotices).toHaveLength(1);
  });

  it('a request whose lookup keeps failing gives up at the eighth round, like any other failure', async () => {
    const { mail, repo, users, clock } = await setup();
    (users.findById as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));
    for (let round = 0; round < 8; round += 1) {
      clock.advance(4 * 60 * MINUTE);
      await mail.processDue();
    }

    expect(repo.rows[0]).toMatchObject({ mailAttempts: 8 });
    expect(repo.rows[0]?.mailGaveUpAt).toBeDefined();
  });
});
