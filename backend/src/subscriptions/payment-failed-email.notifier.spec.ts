// SPEC-012 BR-012-20: every CURRENT member of the office is emailed when a renewal payment fails,
// and no address or name reaches a log (SC-15). Hand-written fakes of the members source and the
// mailer (TS-03, TS-07).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailService } from '../email/email.service.js';
import { FakeEmailSender } from '../../test/fakes/fake-email-sender.js';
import { expectNoneLogged, spyOnLogger } from '../../test/support/logger-spy.js';
import { EmailPaymentFailedNotifier } from './payment-failed-email.notifier.js';
import type { MemberContact, OfficeMembersSource } from './ports/office-members.source.js';

const OFFICE = '64b7f0000000000000000c01';
const ANA: MemberContact = { email: 'ana.ficticia@example.test', name: 'Ana Ficticia' };
const BRUNO: MemberContact = { email: 'bruno.ficticio@example.test', name: 'Bruno Ficticio' };

class FakeMembers implements OfficeMembersSource {
  readonly asked: string[] = [];
  constructor(private readonly contacts: readonly MemberContact[]) {}
  async memberContacts(officeId: string): Promise<readonly MemberContact[]> {
    this.asked.push(officeId);
    return this.contacts;
  }
}

function build(contacts: readonly MemberContact[]) {
  const members = new FakeMembers(contacts);
  const mailbox = new FakeEmailSender();
  const notifier = new EmailPaymentFailedNotifier(members, mailbox as unknown as EmailService);
  return { members, mailbox, notifier };
}

afterEach(() => vi.restoreAllMocks());

describe('EmailPaymentFailedNotifier', () => {
  it('BR-012-20: emails every current member of the office, by name', async () => {
    const t = build([ANA, BRUNO]);

    await t.notifier.notifyPaymentFailed(OFFICE);

    expect(t.members.asked).toEqual([OFFICE]);
    expect(t.mailbox.paymentFailedEmails).toEqual([
      { email: ANA.email, name: ANA.name },
      { email: BRUNO.email, name: BRUNO.name },
    ]);
  });

  it('BR-012-20: an office with no known member sends nothing and does not fail', async () => {
    const t = build([]);

    await expect(t.notifier.notifyPaymentFailed(OFFICE)).resolves.toBeUndefined();

    expect(t.mailbox.paymentFailedEmails).toEqual([]);
  });

  it('a member whose mail fails does not stop the others, and is not retried (nobody is emailed twice)', async () => {
    const t = build([ANA, BRUNO]);
    t.mailbox.failFor.add(ANA.email);

    await expect(t.notifier.notifyPaymentFailed(OFFICE)).resolves.toBeUndefined();

    expect(t.mailbox.paymentFailedEmails.map((sent) => sent.email)).toEqual([BRUNO.email]);
  });

  it('when NOTHING could be sent it fails, so the claim is released and the provider retry sends it', async () => {
    const t = build([ANA, BRUNO]);
    t.mailbox.failFor.add(ANA.email).add(BRUNO.email);

    await expect(t.notifier.notifyPaymentFailed(OFFICE)).rejects.toThrow(
      'No payment failed email could be sent',
    );
  });

  it('SC-15: neither an address nor a name is logged, even when sends fail', async () => {
    const logger = spyOnLogger();
    const t = build([ANA, BRUNO]);
    t.mailbox.failFor.add(ANA.email);

    await t.notifier.notifyPaymentFailed(OFFICE);

    expectNoneLogged(logger.loggedText(), [ANA.email, ANA.name, BRUNO.email, BRUNO.name]);
  });
});
