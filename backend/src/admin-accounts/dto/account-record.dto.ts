// AR-36, BR-009-13, BR-009-21: an account leaves the admin's routes through these classes, each field
// copied explicitly. The record has EXACTLY the fields BR-009-13 lists, plus the history (BR-009-17);
// nothing the account keeps in the product (client lists, profiles, journeys, documents, figures,
// favorites, filters, reminders, simulations) has a field here, and a spec lists the keys and fails
// on any other.
import { ApiProperty } from '@nestjs/swagger';
import type { AccountRecordFacts, AccountSummaryFacts } from '../../users/user-account.js';
import { STATUS_ACTIONS, type StatusAction } from '../domain/account-status-change.js';

/** The statuses an admin sees: never `pending` (a sign-up in flight is not an account yet). */
export const VISIBLE_ACCOUNT_STATUSES = ['active', 'deactivated', 'closed'] as const;

export const SIGN_IN_METHODS = ['password', 'google'] as const;
export type SignInMethod = (typeof SIGN_IN_METHODS)[number];

/** One row of the search (BR-009-13): enough to choose the record to open. */
export class AccountSummaryDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null for an account whose data was purged',
  })
  name: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null for an account whose data was purged',
  })
  email: string | null;

  @ApiProperty({ enum: VISIBLE_ACCOUNT_STATUSES, enumName: 'AccountStatus' })
  status: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  constructor(account: AccountSummaryFacts) {
    this.id = account.id;
    this.name = account.name;
    this.email = account.email;
    this.status = account.status;
    this.createdAt = account.createdAt;
  }
}

/** An office the account is a member of (BR-009-13): its name, and nothing of its clients. */
export class AccountOfficeDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  name: string;

  constructor(office: { readonly id: string; readonly name: string }) {
    this.id = office.id;
    this.name = office.name;
  }
}

/** The plan and subscription status of the account (BR-009-13), from the subscriptions module. */
export class AccountPlanDto {
  @ApiProperty({ type: String, description: 'The plan code, e.g. `advisor_5`' })
  code: string;

  @ApiProperty({
    type: String,
    description: 'The subscription status: ACTIVE, PAST_DUE, CANCELING or LAPSED',
  })
  status: string;

  constructor(plan: { readonly code: string; readonly status: string }) {
    this.code = plan.code;
    this.status = plan.status;
  }
}

/** One deactivation or reactivation (BR-009-17): who, when and why. */
export class AccountHistoryEntryDto {
  @ApiProperty({ enum: STATUS_ACTIONS, enumName: 'AccountStatusAction' })
  action: StatusAction;

  @ApiProperty({ type: String })
  adminId: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The admin’s current name; null if that account no longer has one',
  })
  adminName: string | null;

  @ApiProperty({
    type: String,
    description: 'The reason (a deactivation) or the note (a reactivation); may be empty',
  })
  reason: string;

  @ApiProperty({ type: String, format: 'date-time' })
  at: Date;

  constructor(
    entry: {
      readonly action: StatusAction;
      readonly adminUserId: string;
      readonly reason: string;
      readonly at: Date;
    },
    adminName: string | undefined,
  ) {
    this.action = entry.action;
    this.adminId = entry.adminUserId;
    this.adminName = adminName ?? null;
    this.reason = entry.reason;
    this.at = entry.at;
  }
}

/** BR-009-13 / BR-009-17: the account record an admin opens. */
export class AccountRecordDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null for an account whose data was purged',
  })
  name: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null for an account whose data was purged',
  })
  email: string | null;

  @ApiProperty({ type: String, nullable: true })
  phone: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ enum: SIGN_IN_METHODS, enumName: 'SignInMethod', isArray: true })
  signInMethods: SignInMethod[];

  @ApiProperty({ type: Boolean })
  emailConfirmed: boolean;

  @ApiProperty({ enum: VISIBLE_ACCOUNT_STATUSES, enumName: 'AccountStatus' })
  status: string;

  @ApiProperty({
    type: String,
    isArray: true,
    description: 'The personas the account holds: searcher, advisor, investor, self_advised',
  })
  personas: string[];

  @ApiProperty({ type: () => [AccountOfficeDto] })
  offices: AccountOfficeDto[];

  @ApiProperty({ type: () => AccountPlanDto, nullable: true })
  plan: AccountPlanDto | null;

  @ApiProperty({ type: () => [AccountHistoryEntryDto], description: 'Newest first' })
  history: AccountHistoryEntryDto[];

  constructor(
    account: AccountRecordFacts,
    extra: {
      readonly personas: readonly string[];
      readonly offices: readonly { readonly id: string; readonly name: string }[];
      readonly plan: { readonly code: string; readonly status: string } | null;
      readonly history: readonly AccountHistoryEntryDto[];
    },
  ) {
    this.id = account.id;
    this.name = account.name;
    this.email = account.email;
    this.phone = account.phone;
    this.createdAt = account.createdAt;
    this.signInMethods = signInMethodsOf(account.providers);
    this.emailConfirmed = account.emailVerified;
    this.status = account.status;
    this.personas = [...extra.personas];
    this.offices = extra.offices.map((office) => new AccountOfficeDto(office));
    this.plan = extra.plan ? new AccountPlanDto(extra.plan) : null;
    this.history = [...extra.history];
  }
}

/** `local` is the password; `google` is Google. Any other value stored is not a sign-in method of the record. */
export function signInMethodsOf(providers: readonly string[]): SignInMethod[] {
  const methods: SignInMethod[] = [];
  if (providers.includes('local')) methods.push('password');
  if (providers.includes('google')) methods.push('google');
  return methods;
}

/** The answer of a deactivation or a reactivation: the account and the status it has now. */
export class AccountStatusChangedDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ enum: ['active', 'deactivated'], enumName: 'ChangedAccountStatus' })
  status: string;

  @ApiProperty({ type: String, format: 'date-time', description: 'When the change was made' })
  at: Date;

  constructor(changed: { readonly id: string; readonly status: string; readonly at: Date }) {
    this.id = changed.id;
    this.status = changed.status;
    this.at = changed.at;
  }
}
