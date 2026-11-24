// SPEC-009 BR-009-13, BR-009-14: the admin's search of accounts and the account record. Both are
// LOGGED before anything is returned (AccountLookupLogger, fail closed): a search writes one entry
// (kind, length and keyed hash of the terms, never the terms), a record viewed writes one entry (the
// admin and the account id). The record has exactly the fields BR-009-13 lists, read through named
// projections (users, subscriptions) and the access context of THAT account; nothing it keeps in
// the product (favorites, reminders, filters, journeys, profiles, figures) is read at all.
import { Inject, Injectable } from '@nestjs/common';
import { type AccessContext, AccessContextFactory } from '../access/access-context.js';
import { isObjectIdString } from '../access/owner-filter.js';
import { AccountLookupLogger } from '../admin-access/account-lookup-logger.js';
import { DomainError } from '../common/errors/domain-error.js';
import { type Paginated, paginated } from '../common/pagination/paginated.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import type { AccountSummaryFacts } from '../users/user-account.js';
import { UsersService } from '../users/users.service.js';
import { AccountStatusEventsRepository } from './account-status-events.repository.js';
import { searchKindOf } from './domain/account-search.js';
import { AccountHistoryEntryDto, AccountRecordDto } from './dto/account-record.dto.js';
import type { AccountSearchQueryDto } from './dto/account-search-query.dto.js';
import {
  ACCOUNT_OFFICES_SOURCE,
  type AccountOfficesSource,
} from './ports/account-offices.source.js';

@Injectable()
export class AdminAccountsService {
  constructor(
    private readonly users: UsersService,
    private readonly history: AccountStatusEventsRepository,
    private readonly lookups: AccountLookupLogger,
    private readonly contexts: AccessContextFactory,
    private readonly subscriptions: SubscriptionsService,
    @Inject(ACCOUNT_OFFICES_SOURCE) private readonly offices: AccountOfficesSource,
  ) {}

  /** BR-009-13, BR-009-14: one page of matches; the search is logged first, even when it finds nothing. */
  async search(
    admin: AccessContext,
    query: AccountSearchQueryDto,
  ): Promise<Paginated<AccountSummaryFacts>> {
    const terms = query.q; // already normalised by the DTO
    const kind = searchKindOf(terms);
    await this.lookups.logSearch(admin.accountId, { kind, terms });
    const { items, total } = await this.users.searchAccounts({ kind, text: terms }, query);
    return paginated(items, total, query);
  }

  /**
   * BR-009-13, BR-009-14: the record of one account, NOT_FOUND for an unknown or malformed id and for a
   * sign-up still pending. The view is logged before the record is assembled and returned.
   */
  async record(admin: AccessContext, accountId: string): Promise<AccountRecordDto> {
    if (!isObjectIdString(accountId)) throw new DomainError('NOT_FOUND');
    const account = await this.users.findAccountRecord(accountId);
    if (!account) throw new DomainError('NOT_FOUND');
    await this.lookups.logView(admin.accountId, account.id);

    const [context, offices, events] = await Promise.all([
      this.contexts.forAccount({ userId: account.id, isAdmin: account.isAdmin }),
      this.offices.officesOf(account.id),
      this.history.historyOf(account.id),
    ]);
    const [plan, names] = await Promise.all([
      this.subscriptions.displayedPlanOfAccount(
        account.id,
        offices.map((office) => office.id),
      ),
      this.users.namesOf(events.map((event) => event.adminUserId)),
    ]);
    return new AccountRecordDto(account, {
      personas: context.personas,
      offices,
      plan,
      history: events.map(
        (event) => new AccountHistoryEntryDto(event, names.get(event.adminUserId)),
      ),
    });
  }
}
