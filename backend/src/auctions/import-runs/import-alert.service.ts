import { Injectable, Logger } from '@nestjs/common';
import { jobErrorCode } from '../../common/services/job-error-code.js';
import { EmailService } from '../../email/email.service.js';
import { UsersService } from '../../users/users.service.js';
import { alertContent, alertOutcomeOf } from '../domain/import-alert-text.js';
import type { ImportRunRecord } from './import-run.js';
import { ImportRunService } from './import-run.service.js';

/** How an `alertIfDue` ended, for the caller and the tests. */
export type AlertResult =
  | { kind: 'not_due' }
  /** Another process claimed it first: that one sends. */
  | { kind: 'claimed_elsewhere' }
  | { kind: 'sent'; recipients: number }
  /** Nobody could be told; the claim is back, so the next tick tries again. */
  | { kind: 'released' };

/**
 * SPEC-004 BR-004-29: ONE email to every admin per Import Run that ended badly: FAILED,
 * REJECTED_LIST, NO_NEW_LIST on a business day, or an applied run whose collection was blocked.
 * Never for NO_UPDATE (DL-004-12): the run is only ever NO_NEW_LIST on a business day, so the
 * calendar decision is already made when the run is decided.
 *
 * Exactly once: `alertedAt` is claimed with an atomic conditional update (null -> now) BEFORE
 * anything is sent, so several failed attempts, two ticks at once or a second process cannot send
 * two. If not one email went out (no admin, or every send failed) the claim is released and the
 * next tick tries again; a failure here never fails the run. Several attempts of a day that fail
 * do not alert at all: the alert is about the day's final outcome. A run that is REJECTED_LIST at
 * 06:00 and SUCCESS at 09:00 never alerts, and its `alertedAt` stays null (the rejection stays in
 * `failureReasons`, as history).
 *
 * The email says the day, the outcome and a reason chosen BY CODE from a catalogue (pt-BR); no
 * exception text, no row, no personal data. Recipients are the admins of `UsersService` (AR-09).
 * Addresses are never logged (SC-15).
 */
@Injectable()
export class ImportAlertService {
  private readonly logger = new Logger(ImportAlertService.name);

  constructor(
    private readonly runs: ImportRunService,
    private readonly users: UsersService,
    private readonly email: EmailService,
  ) {}

  async alertIfDue(run: ImportRunRecord): Promise<AlertResult> {
    const outcome = alertOutcomeOf(run);
    if (outcome === null) return { kind: 'not_due' };
    if (!(await this.runs.claimAlert(run.id))) return { kind: 'claimed_elsewhere' };

    const content = alertContent(outcome, run.brasiliaDate, run.failureReasons);
    let sent = 0;
    try {
      for (const address of await this.users.findAdminEmails()) {
        try {
          await this.email.sendImportAlertEmail(address, content);
          sent++;
        } catch (error) {
          // One address failing does not stop the others. The code only, never the address.
          this.logger.warn(`An import alert could not be sent: ${jobErrorCode(error)}`);
        }
      }
    } catch (error) {
      this.logger.error(`The admins of an import alert could not be read: ${jobErrorCode(error)}`);
    }

    if (sent === 0) {
      await this.runs.releaseAlert(run.id);
      this.logger.warn(`Import alert for ${run.brasiliaDate} reached nobody: will try again`);
      return { kind: 'released' };
    }
    this.logger.log(`Import alert for ${run.brasiliaDate} sent to ${sent} admin(s)`);
    return { kind: 'sent', recipients: sent };
  }

  /**
   * The runs that still owe an alert (their claim was released, or the process died after the run
   * was decided and before it was sent). Never throws: an alert is best-effort.
   */
  async retryPending(): Promise<void> {
    try {
      for (const run of await this.runs.findAlertCandidates()) {
        await this.alertIfDue(run);
      }
    } catch (error) {
      this.logger.error(`Pending import alerts could not be processed: ${jobErrorCode(error)}`);
    }
  }
}
