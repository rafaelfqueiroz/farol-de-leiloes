// SPEC-009 BR-009-05, BR-009-08, BR-009-09: the rules of one support request that are not framework
// concerns: the length limits, the data-access permission and what withdrawing it does. Pure (AR-05):
// time comes in as an argument.

export const SUPPORT_REQUEST_STATUSES = ['open', 'closed'] as const;
export type SupportRequestStatus = (typeof SUPPORT_REQUEST_STATUSES)[number];

/** BR-009-05: characters, counted after the text is trimmed. */
export const SUBJECT_LENGTH = { min: 3, max: 200 } as const;
export const MESSAGE_LENGTH = { min: 10, max: 5000 } as const;

/** What the rules need to know of a request. */
export interface SupportRequestState {
  readonly status: SupportRequestStatus;
  /** The option the requester ticked in the form (unticked by default, BR-009-08). */
  readonly allowDataAccess: boolean;
  /** When the requester withdrew the permission. */
  readonly dataAccessWithdrawnAt?: Date | undefined;
}

/**
 * The permission as the requester and the admin see it (BR-009-09): never given, given and still
 * in force, or given and withdrawn.
 */
export type DataAccessState = 'not_given' | 'allowed' | 'withdrawn';

export function dataAccessState(request: SupportRequestState): DataAccessState {
  if (!request.allowDataAccess) return 'not_given';
  return request.dataAccessWithdrawnAt ? 'withdrawn' : 'allowed';
}

/**
 * BR-002-24: whether the requester's permission is in force. It says nothing of the request being
 * open: a support access grant needs both (SupportGrantService reads `open` and this apart).
 */
export function isDataAccessAllowed(request: SupportRequestState): boolean {
  return dataAccessState(request) === 'allowed';
}

/**
 * BR-009-08: what withdrawing the permission does now. `closed`: the request is closed, nothing
 * changes and the caller is told so; `withdraw`: the permission is in force and ends; `unchanged`:
 * there is nothing to withdraw (never given, or already withdrawn), and asking again is not an error.
 */
export type WithdrawalOutcome = 'closed' | 'withdraw' | 'unchanged';

export function withdrawalOutcome(request: SupportRequestState): WithdrawalOutcome {
  if (request.status === 'closed') return 'closed';
  return isDataAccessAllowed(request) ? 'withdraw' : 'unchanged';
}
