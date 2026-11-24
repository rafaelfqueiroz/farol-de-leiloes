// SPEC-009 BR-009-15, BR-009-17, BR-009-19: the rules of an account's status change that are not
// framework concerns. Pure (AR-05, 100% branch, TS-24): what an admin may do to an account, and the
// reason's limits. The write itself is one conditional update (UsersService.deactivateAccount /
// reactivateAccount); these functions say what is asked of it and what its answer means.

export const STATUS_ACTIONS = ['deactivated', 'reactivated'] as const;
export type StatusAction = (typeof STATUS_ACTIONS)[number];

/** BR-009-15: the reason of a deactivation is required; BR-009-17: a note on a reactivation is optional. */
export const REASON_LENGTH = { min: 3, max: 500 } as const;
export const NOTE_LENGTH = { max: 500 } as const;

/** BR-009-19: an admin cannot deactivate the account they are signed in with. */
export function isOwnAccount(adminAccountId: string, targetAccountId: string): boolean {
  return adminAccountId === targetAccountId;
}

/** What the admin asks of an account in `status`: nothing but `active` -> `deactivated` and `deactivated` -> `active` (BR-009-21). */
export function allowedChange(status: string): StatusAction | null {
  if (status === 'active') return 'deactivated';
  if (status === 'deactivated') return 'reactivated';
  return null;
}

/**
 * Whether an action fits the status the account has NOW: deactivating needs `active`, reactivating
 * needs `deactivated`. A `closed` or `pending` account takes neither, and an exact repeat is refused
 * (a conflict, no second history entry).
 */
export function fitsStatus(action: StatusAction, status: string): boolean {
  return allowedChange(status) === action;
}
