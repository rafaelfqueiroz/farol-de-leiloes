// SPEC-012 BR-012-20: the PAYMENT_FAILED_NOTIFIER the billing PR binds. Every CURRENT member of the
// office (OFFICE_MEMBERS_SOURCE, SPEC-011, read now: AR-13) gets the email with a link to update
// the payment method. The webhook decides WHEN (a claim on the event, so a replay sends once);
// this decides HOW.
//
// SC-15: the log carries counts only, never an address or a name. A send that fails for ONE member
// does not stop the others and is not retried (a retry would email the members who already got it
// twice); when NOTHING could be sent it throws, which releases the claim so the provider's retry
// sends the email.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../email/email.service.js';
import { OFFICE_MEMBERS_SOURCE, type OfficeMembersSource } from './ports/office-members.source.js';
import type { PaymentFailedNotifier } from './ports/payment-failed.notifier.js';

@Injectable()
export class EmailPaymentFailedNotifier implements PaymentFailedNotifier {
  private readonly logger = new Logger(EmailPaymentFailedNotifier.name);

  constructor(
    @Inject(OFFICE_MEMBERS_SOURCE) private readonly members: OfficeMembersSource,
    private readonly email: EmailService,
  ) {}

  async notifyPaymentFailed(officeId: string): Promise<void> {
    const contacts = await this.members.memberContacts(officeId);
    let sent = 0;
    let failed = 0;
    for (const contact of contacts) {
      try {
        await this.email.sendPaymentFailedEmail(contact.email, contact.name);
        sent += 1;
      } catch {
        // The error may quote the address: only the fact is kept (SC-15).
        failed += 1;
      }
    }
    if (failed > 0) {
      this.logger.warn(`Payment failed email: ${sent} sent, ${failed} failed (office ${officeId})`);
    }
    if (sent === 0 && failed > 0) throw new Error('No payment failed email could be sent');
    this.logger.log(`Payment failed email sent to ${sent} of ${contacts.length} members`);
  }
}
