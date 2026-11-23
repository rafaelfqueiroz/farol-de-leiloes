// SC-15 / AR-46 (#72): opening a support request logs neither the requester, nor the subject, nor the
// message, nor an address. The old flow logged the title's length only; the stored flow logs the id.
// #72 was fixed on main (#95); this spec keeps it fixed for the new service and its mail outbox.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { anAccessContext } from '../../test/fakes/fake-access-sources.js';
import { FakeClock } from '../../test/fakes/fake-clock.js';
import { FakeEmailSender } from '../../test/fakes/fake-email-sender.js';
import { FakeSupportRequestsRepository } from '../../test/fakes/fake-support-requests-repository.js';
import { expectNoneLogged, spyOnLogger } from '../../test/support/logger-spy.js';
import { testConfigService } from '../../test/support/test-env.js';
import type { SupportGrantService } from '../admin-access/support-grant.service.js';
import type { EmailService } from '../email/email.service.js';
import type { UsersService } from '../users/users.service.js';
import { SupportCountersRepository } from './support-counters.repository.js';
import { SupportMailService } from './support-mail.service.js';
import { SupportService } from './support.service.js';

afterEach(() => vi.restoreAllMocks());

const REQUESTER = {
  name: 'Fulana Ficticia',
  email: 'fulana.ficticia@example.test',
  status: 'active',
};
const SUBJECT = 'titulo-ficticio';
const MESSAGE = 'descricao-ficticia-privada';

async function serviceOver(mailbox: FakeEmailSender) {
  const requests = new FakeSupportRequestsRepository();
  const clock = new FakeClock(new Date('2099-01-15T12:00:00.000Z'));
  const config = testConfigService() as unknown as ConfigService<never, true>;
  const mail = new SupportMailService(
    requests as never,
    { findById: vi.fn().mockResolvedValue(REQUESTER) } as unknown as UsersService,
    mailbox as unknown as EmailService,
    config,
    clock,
  );
  let sequence = 0;
  const counters = {
    next: () => Promise.resolve(++sequence),
  } as unknown as SupportCountersRepository;
  const service = new SupportService(
    requests as never,
    counters,
    mail,
    { endForSupportRequest: vi.fn() } as unknown as SupportGrantService,
    config,
    clock,
  );
  return { service, ctx: await anAccessContext('64b7f0000000000000000011') };
}

describe('SupportService logging', () => {
  it('logs neither the sender email, the name, the subject nor the message, with the mail sent', async () => {
    const logger = spyOnLogger();
    const { service, ctx } = await serviceOver(new FakeEmailSender());

    await service.create(ctx, { subject: SUBJECT, message: MESSAGE, allowDataAccess: false });

    expectNoneLogged(logger.loggedText(), [REQUESTER.email, REQUESTER.name, SUBJECT, MESSAGE]);
    expect(logger.loggedText()).toContain('Support request submitted');
  });

  it('logs none of them either when the mail server is down', async () => {
    const logger = spyOnLogger();
    const mailbox = new FakeEmailSender();
    mailbox.supportMailDown = true;
    const { service, ctx } = await serviceOver(mailbox);

    const { confirmationSent } = await service.create(ctx, {
      subject: SUBJECT,
      message: MESSAGE,
      allowDataAccess: true,
    });

    expect(confirmationSent).toBe(false);
    expectNoneLogged(logger.loggedText(), [REQUESTER.email, REQUESTER.name, SUBJECT, MESSAGE]);
  });
});
