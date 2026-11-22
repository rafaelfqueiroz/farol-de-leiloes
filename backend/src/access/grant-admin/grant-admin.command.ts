// SPEC-002 DL-002-05 / BR-002-21: GrantAdminPorts over UsersService and the SPEC-002 access sources,
// whatever implementation the specs that own them (SPEC-011, SPEC-016) have bound.
import { Inject, Injectable } from '@nestjs/common';
import { UsersService } from '../../users/users.service.js';
import { isAccountActive } from '../../users/user-account.js';
import { CLIENT_LINK_SOURCE, type ClientLinkSource } from '../sources/client-link.source.js';
import { MEMBERSHIP_SOURCE, type MembershipSource } from '../sources/membership.source.js';
import { SELF_ADVISED_SOURCE, type SelfAdvisedSource } from '../sources/self-advised.source.js';
import {
  type AdminAccount,
  type AdminCapabilityChange,
  changeAdminCapability,
  type GrantAdminOutcome,
  type GrantAdminPorts,
} from './grant-admin.js';

/** GrantAdminPorts over UsersService and the access sources. */
@Injectable()
export class GrantAdminCommand implements GrantAdminPorts {
  constructor(
    private readonly users: UsersService,
    @Inject(MEMBERSHIP_SOURCE) private readonly memberships: MembershipSource,
    @Inject(CLIENT_LINK_SOURCE) private readonly clientLinks: ClientLinkSource,
    @Inject(SELF_ADVISED_SOURCE) private readonly selfAdvised: SelfAdvisedSource,
  ) {}

  run(email: string, change: AdminCapabilityChange): Promise<GrantAdminOutcome> {
    return changeAdminCapability(this, { email, change });
  }

  async findAccountByEmail(email: string): Promise<AdminAccount | null> {
    const account = await this.users.findByEmail(email);
    if (!account) return null;
    return {
      id: account._id.toHexString(),
      isAdmin: account.isAdmin === true,
      legacyAdminRole: account.role === 'admin',
      emailVerified: account.emailVerified === true,
      // BR-001-16 / AR-28: a document without a status predates the field and is active.
      active: isAccountActive(account),
    };
  }

  setAdminCapability(accountId: string, isAdmin: boolean): Promise<boolean> {
    return this.users.setAdminCapability(accountId, isAdmin);
  }

  /** BR-002-21: any membership, any client link (active or ended), any journey, self-advised. */
  async hasClientRelationships(accountId: string): Promise<boolean> {
    const [memberships, links, journeyAsInvestor, selfAdvised] = await Promise.all([
      this.memberships.activeMemberships(accountId),
      this.clientLinks.clientLinks(accountId),
      this.clientLinks.hasJourneyAsInvestor(accountId),
      this.selfAdvised.isSelfAdvised(accountId),
    ]);
    return memberships.length > 0 || links.length > 0 || journeyAsInvestor || selfAdvised;
  }
}
