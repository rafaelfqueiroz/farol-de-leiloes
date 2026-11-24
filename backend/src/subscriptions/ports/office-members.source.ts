// SPEC-012 BR-012-20 seam, plugged by SPEC-011 (offices): who is told when a renewal payment
// fails. Every member of the office gets the email, so the source answers the contact of each
// CURRENT member, read now (AR-13).
//
// SPEC-009 BR-009-15: an account that is DEACTIVATED receives no notification, so an implementation
// answers the contacts of ACTIVE accounts only (a deactivated member keeps their membership, BR-009-16,
// but is not mailed).
//
// Until SPEC-011 binds a real implementation to OFFICE_MEMBERS_SOURCE (in SubscriptionsModule),
// the default knows no member: nobody is emailed, and the loss is logged as a count (SC-15).
import { Logger } from '@nestjs/common';

/** Personal data (SC-15): never logged, never in an error, never in an AI prompt. */
export interface MemberContact {
  readonly email: string;
  readonly name: string;
}

export interface OfficeMembersSource {
  memberContacts(officeId: string): Promise<readonly MemberContact[]>;
}

export const OFFICE_MEMBERS_SOURCE = Symbol('OFFICE_MEMBERS_SOURCE');

/** Before SPEC-011: no office has a member. */
export class NoOfficeMembersSource implements OfficeMembersSource {
  private readonly logger = new Logger(NoOfficeMembersSource.name);

  memberContacts(): Promise<readonly MemberContact[]> {
    this.logger.warn('OFFICE_MEMBERS_SOURCE is not bound (SPEC-011): 0 member contacts');
    return Promise.resolve([]);
  }
}
