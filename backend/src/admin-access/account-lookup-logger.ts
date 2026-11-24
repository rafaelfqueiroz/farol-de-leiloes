// SPEC-009 BR-009-14, DL-009-06 / SPEC-002 BR-002-27: every account search and every account record an
// admin views is logged BEFORE anything is returned, and if the entry cannot be written the lookup is
// refused (fail closed), exactly like a read of client data under a grant (GrantReadLogger). The
// caller returns only what it got after `logSearch` / `logView` resolved: a route that skips the call
// has nothing to skip, because it is the only thing between the lookup and the answer
// (AdminAccountsService, held by a spec that runs the real routes against a failing log).
//
// What an entry holds. A search: the admin, the time and `query` = `<kind>:<length>:<hmac>` of the
// normalised terms (domain/search-log-query.ts): never a name or an address. A view: the admin, the
// time and `resource { type: 'account', id }`. Neither names an owner (`owner` is client data's), and
// neither carries a grant or a support request.
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../common/clock/clock.js';
import { logSafeError } from '../common/errors/log-safe-error.js';
import type { Env } from '../config/env.js';
import { AdminAccessLogRepository } from './admin-access-log.repository.js';
import { type SearchKind, searchLogQuery } from './domain/search-log-query.js';
import { AdminAccessLogUnavailableError } from './grant-read-logger.js';

/** The search as the log sees it: its kind and its NORMALISED terms (never kept, only measured and hashed). */
export interface LoggedSearch {
  readonly kind: SearchKind;
  readonly terms: string;
}

@Injectable()
export class AccountLookupLogger {
  private readonly logger = new Logger(AccountLookupLogger.name);
  private readonly secret: string | undefined;

  constructor(
    private readonly logs: AdminAccessLogRepository,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    // AR-46: the same key that hashes users in the logs; optional outside production (AR-41).
    this.secret = config.get('LOG_HASH_SECRET', { infer: true });
  }

  /** One entry for one search, even one with no result; throws `AdminAccessLogUnavailableError` when it cannot be written. */
  async logSearch(adminUserId: string, search: LoggedSearch): Promise<void> {
    await this.write({
      adminUserId,
      action: 'account_search',
      query: searchLogQuery(this.secret, search.kind, search.terms),
      at: this.clock.now(),
    });
  }

  /** One entry for one account record viewed; throws `AdminAccessLogUnavailableError` when it cannot be written. */
  async logView(adminUserId: string, accountId: string): Promise<void> {
    await this.write({
      adminUserId,
      action: 'account_view',
      resource: { type: 'account', id: accountId },
      at: this.clock.now(),
    });
  }

  private async write(entry: Parameters<AdminAccessLogRepository['append']>[0][number]) {
    try {
      await this.logs.append([entry]);
    } catch (error) {
      // SC-15: the driver's code or class only, never its message (it may quote values).
      this.logger.error(`BR-009-14: admin access log not written (${logSafeError(error)})`);
      throw new AdminAccessLogUnavailableError();
    }
  }
}
