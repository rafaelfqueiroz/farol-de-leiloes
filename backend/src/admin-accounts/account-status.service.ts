// SPEC-009 BR-009-15..BR-009-19: deactivating and reactivating an account. The ONE place an account's
// status is changed on an admin's behalf; every other write to an account stays in its own flow
// (BR-009-21: no route edits a profile, an email, personas, memberships or a plan).
//
// A change is ONE transaction: the conditional update of the account's status (which also moves its
// credential version, so every older session is dead for good: SC-03, DL-001-02), a write on the ACTING
// admin's own account (they must still be an active admin when it commits, BR-009-19) and the insert of
// the history entry. They commit together or not at all, so a status never changes without its entry
// and an entry never exists for a change that did not happen. The conditional update decides a race: of
// two admins deactivating the same account exactly one matches; the other's transaction ends in
// ACCOUNT_STATE_CONFLICT with nothing written. Two transactions that touch the same account at once
// conflict in MongoDB (a transient write conflict) and the driver retries the loser, which then meets
// the winner's state: so two admins deactivating each other cannot both succeed.
//
// After the commit: a deactivated account's open support grants end (BR-002-26) and its sessions are
// revoked through the auth module's exported API (both tidy-ups on top of what already refuses them, so
// a failure is logged and does not undo the change). A reactivation ends any grant left and cancels the
// account's reminders already due (BR-009-17) BEFORE the status flips (nothing can see the account
// active with them), and cancels the reminders once more after, for the instant in between. Nothing is
// deleted or moved: favorites, reminders yet to come, memberships, the subscription and the journeys are
// not touched (BR-009-16).
import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { type Connection } from 'mongoose';
import type { AccessContext } from '../access/access-context.js';
import { canonicalObjectId, isObjectIdString } from '../access/owner-filter.js';
import { SupportGrantService } from '../admin-access/support-grant.service.js';
import { AuthService } from '../auth/auth.service.js';
import { Clock } from '../common/clock/clock.js';
import { DomainError } from '../common/errors/domain-error.js';
import { logSafeError } from '../common/errors/log-safe-error.js';
import { RemindersService } from '../reminders/reminders.service.js';
import { UsersService } from '../users/users.service.js';
import { AccountStatusEventsRepository } from './account-status-events.repository.js';
import { isOwnAccount, type StatusAction } from './domain/account-status-change.js';

/** What a change answers: the account and the status it has now. */
export interface AccountStatusChanged {
  readonly id: string;
  readonly status: 'active' | 'deactivated';
  readonly at: Date;
}

@Injectable()
export class AccountStatusService {
  private readonly logger = new Logger(AccountStatusService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly users: UsersService,
    private readonly events: AccountStatusEventsRepository,
    private readonly auth: AuthService,
    private readonly reminders: RemindersService,
    private readonly grants: SupportGrantService,
    private readonly clock: Clock, // AR-24
  ) {}

  /**
   * BR-009-15, BR-009-19: `active` -> `deactivated`, with a required reason. An admin cannot
   * deactivate the account they are signed in with (checked before anything is read). A closed,
   * pending or already deactivated account is ACCOUNT_STATE_CONFLICT; an unknown or malformed id is
   * NOT_FOUND. An admin MAY deactivate another admin: nothing in the rules forbids it, and the grant
   * service refuses a requester that is not active.
   */
  async deactivate(
    admin: AccessContext,
    requestedId: string,
    reason: string,
  ): Promise<AccountStatusChanged> {
    if (!isObjectIdString(requestedId)) throw new DomainError('NOT_FOUND');
    const accountId = canonicalObjectId(requestedId);
    if (isOwnAccount(admin.accountId, accountId)) {
      throw new DomainError('CANNOT_DEACTIVATE_OWN_ACCOUNT');
    }
    const at = await this.change(admin, accountId, 'deactivated', reason);
    // The credential version already ended every session (SC-03); revoking them is the tidy-up.
    await this.auth.endAllSessionsAndLinks(accountId).catch((error: unknown) => {
      // SC-15: the kind of failure only. The change stands: no session of the old credential works.
      this.logger.warn(
        `Sessions of a deactivated account not all revoked (${logSafeError(error)})`,
      );
    });
    // BR-002-24, BR-002-26: a deactivated admin's open support grants end with the account, so they
    // block no other admin and do not come back with a reactivation. A failure is logged and does not
    // undo the change: `SupportGrantService.open` also ends a grant whose holder is no longer an
    // active admin, and the reactivation ends them again before the account can be used.
    await this.grants.endAllOfAdmin(accountId).catch((error: unknown) => {
      this.logger.warn(`Grants of a deactivated account not all ended (${logSafeError(error)})`);
    });
    return { id: accountId, status: 'deactivated', at };
  }

  /**
   * BR-009-17: `deactivated` -> `active`, with an optional note. No session comes back (the version
   * moved, and moves again here) and the memberships are as they were. Reminders already due are
   * cancelled, never sent late.
   */
  async reactivate(
    admin: AccessContext,
    requestedId: string,
    note: string,
  ): Promise<AccountStatusChanged> {
    if (!isObjectIdString(requestedId)) throw new DomainError('NOT_FOUND');
    const accountId = canonicalObjectId(requestedId);
    // Only an account that IS deactivated has its reminders touched: a reactivation aimed at an active
    // one is a conflict that changes nothing at all.
    const record = await this.users.findAccountRecord(accountId);
    if (!record) throw new DomainError('NOT_FOUND');
    if (record.status !== 'deactivated') throw new DomainError('ACCOUNT_STATE_CONFLICT');
    await this.reminders.cancelDueOfAccount(accountId); // BR-009-17, before the account can be active
    await this.grants.endAllOfAdmin(accountId); // BR-002-26: no earlier grant comes back
    const at = await this.change(admin, accountId, 'reactivated', note);
    await this.reminders.cancelDueOfAccount(accountId).catch((error: unknown) => {
      this.logger.warn(
        `Reminders due at a reactivation not all cancelled (${logSafeError(error)})`,
      );
    });
    return { id: accountId, status: 'active', at };
  }

  private async change(
    admin: AccessContext,
    accountId: string,
    action: StatusAction,
    reason: string,
  ): Promise<Date> {
    const at = this.clock.now();
    await this.connection.transaction(async (session) => {
      const outcome =
        action === 'deactivated'
          ? await this.users.deactivateAccount(accountId, { session })
          : await this.users.reactivateAccount(accountId, { session });
      if (outcome.result === 'not_found') throw new DomainError('NOT_FOUND');
      if (outcome.result === 'conflict') throw new DomainError('ACCOUNT_STATE_CONFLICT');
      // BR-009-19: the ACTING admin must still be an active admin when the change commits. The write on
      // their own document is what makes two admins deactivating each other (or an admin being
      // deactivated while still acting) conflict, so one of the two transactions meets the other's
      // result and is refused: account administration never ends with no active admin.
      if (!(await this.users.recordAdminAction(admin.accountId, { session }))) {
        throw new DomainError('FORBIDDEN');
      }
      await this.events.append(
        { userId: accountId, action, adminUserId: admin.accountId, reason, at },
        session,
      );
    });
    // SC-15: the action only; the account and the admin are in the history, not in the log.
    this.logger.log(`Account ${action} by an admin`);
    return at;
  }
}
