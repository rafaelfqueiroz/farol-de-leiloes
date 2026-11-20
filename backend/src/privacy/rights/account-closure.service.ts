// SPEC-010 BR-010-13, BR-010-14, BR-010-16, BR-010-17, AR-31: closing the signed-in account, at once
// and for good. Closure NEVER deletes personal data (that is the purge job's, within 30 days, AR-31);
// it ends what the account can do and what anyone can do with it:
//
//   1. proof of identity again: the current password (counted like a sign-in attempt, SC-04) or a
//      fresh Google sign-in's one-time code, of THIS account (BR-010-13);
//   2. ONE conditional update `active | deactivated -> closed` that also sets `closedAt` (Clock) and
//      bumps the credential version (UsersService.closeAccount, SC-03): from this write on every
//      sign-in method is refused, a session is refused on its next request (status AND credential
//      version, so a sign-in that passed its checks a moment before cannot keep one), and a second
//      closure is not a transition. Of two closures at once exactly one wins this update;
//   3. the effects, each attempted, idempotent and repeatable: every session revoked and the
//      outstanding one-time links removed, the account's queued or ready exports cancelled, and the
//      registered `AccountClosureHook`s (SPEC-011 ends the investor's links and an advisor's
//      memberships, BR-010-16/17; SPEC-012 its billing hooks). A failing step is logged by name and
//      repaired by the purge job, which runs the same effects again; the account is closed whatever
//      happens here.
//
// Idempotent: closing an account that is already closed answers the same success and does nothing.
// That includes the loser of two closures at once, whose re-authentication may find the account
// closed by the winner already.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuthService, type ReauthenticationProof } from '../../auth/auth.service.js';
import { Clock } from '../../common/clock/clock.js';
import { DomainError } from '../../common/errors/domain-error.js';
import { UsersService } from '../../users/users.service.js';
import { DataExportsRepository } from './data-exports.repository.js';

/**
 * A step another spec runs when an account is closed (SPEC-011: end the investor's client links and
 * the advisor's memberships; SPEC-012). It must be IDEMPOTENT: the purge job runs it again for every
 * closed account it purges, which is what repairs a crash between the closure and this step. A hook
 * that throws never undoes the closure; it is logged by name and repeated.
 */
export interface AccountClosureHook {
  /** Stable, letters and digits and dashes: it names the step in the log (SC-15: no data). */
  readonly name: string;
  onAccountClosed(userId: string): Promise<void>;
}

/** DI token of the registered hooks, a list; the module binds it to none until a spec binds its own. */
export const ACCOUNT_CLOSURE_HOOKS = Symbol('ACCOUNT_CLOSURE_HOOKS');

@Injectable()
export class AccountClosureService {
  private readonly logger = new Logger(AccountClosureService.name);

  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly exports: DataExportsRepository,
    @Inject(ACCOUNT_CLOSURE_HOOKS) private readonly hooks: readonly AccountClosureHook[],
    private readonly clock: Clock, // AR-24
  ) {}

  /** Closes the account of the session (see the header). `ip` is the origin the attempt counts for. */
  async closeOwnAccount(userId: string, proof: ReauthenticationProof, ip: string): Promise<void> {
    if (await this.isClosed(userId)) return;

    try {
      await this.auth.reauthenticate(userId, proof, ip);
    } catch (error) {
      // A closure racing this one may have closed the account while the proof was being checked
      // (a closed account's password no longer verifies): that is success, not a refusal. Any
      // other failure is the refusal it is; it reveals nothing, the account is not closed.
      if (await this.isClosed(userId)) return;
      throw error;
    }

    const outcome = await this.users.closeAccount(userId, this.clock.now());
    if (outcome === 'already_closed') return; // lost the race: the winner runs the effects
    if (outcome === 'not_found') throw new DomainError('USER_NOT_FOUND');

    const failed = await this.applyClosureEffects(userId);
    if (failed.length > 0) {
      // SC-15: step names only. The account IS closed; the purge job repeats these.
      this.logger.error(
        `Account closure: ${failed.length} step(s) incomplete (${failed.join(', ')}); the purge job repeats them`,
      );
    }
  }

  /**
   * The effects of a closure, each attempted whatever the others did, answered as the names of the
   * ones that failed. Idempotent: also run by the purge job for each account it purges.
   */
  async applyClosureEffects(userId: string): Promise<string[]> {
    const steps: { name: string; run: () => Promise<unknown> }[] = [
      { name: 'sessions-and-links', run: () => this.auth.endAllSessionsAndLinks(userId) },
      { name: 'exports', run: () => this.exports.cancelLiveOf(userId) },
      ...this.hooks.map((hook) => ({
        name: `hook-${hook.name}`,
        run: () => hook.onAccountClosed(userId),
      })),
    ];
    const failed: string[] = [];
    for (const step of steps) {
      try {
        await step.run();
      } catch {
        failed.push(step.name);
      }
    }
    return failed;
  }

  private async isClosed(userId: string): Promise<boolean> {
    return (await this.users.findById(userId))?.status === 'closed';
  }
}
