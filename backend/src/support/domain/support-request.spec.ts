// SPEC-009 BR-009-08, BR-009-09: the permission and its withdrawal.
import { describe, expect, it } from 'vitest';
import {
  dataAccessState,
  isDataAccessAllowed,
  withdrawalOutcome,
  type SupportRequestState,
} from './support-request.js';

const WITHDRAWN_AT = new Date('2026-03-01T12:00:00.000Z');
const open = (rest: Partial<SupportRequestState> = {}): SupportRequestState => ({
  status: 'open',
  allowDataAccess: false,
  ...rest,
});

describe('dataAccessState', () => {
  it('is not_given when the option was never ticked, even with a stray withdrawal date', () => {
    expect(dataAccessState(open())).toBe('not_given');
    expect(dataAccessState(open({ dataAccessWithdrawnAt: WITHDRAWN_AT }))).toBe('not_given');
  });

  it('is allowed when ticked and not withdrawn, withdrawn once withdrawn', () => {
    expect(dataAccessState(open({ allowDataAccess: true }))).toBe('allowed');
    expect(dataAccessState(open({ allowDataAccess: true, dataAccessWithdrawnAt: undefined }))).toBe(
      'allowed',
    );
    expect(
      dataAccessState(open({ allowDataAccess: true, dataAccessWithdrawnAt: WITHDRAWN_AT })),
    ).toBe('withdrawn');
  });
});

describe('isDataAccessAllowed', () => {
  it('is true only for a permission given and not withdrawn', () => {
    expect(isDataAccessAllowed(open({ allowDataAccess: true }))).toBe(true);
    expect(isDataAccessAllowed(open())).toBe(false);
    expect(
      isDataAccessAllowed(open({ allowDataAccess: true, dataAccessWithdrawnAt: WITHDRAWN_AT })),
    ).toBe(false);
  });
});

describe('withdrawalOutcome', () => {
  it('withdraws a permission in force on an open request', () => {
    expect(withdrawalOutcome(open({ allowDataAccess: true }))).toBe('withdraw');
  });

  it('leaves a request without a permission in force unchanged, with no error', () => {
    expect(withdrawalOutcome(open())).toBe('unchanged');
    expect(
      withdrawalOutcome(open({ allowDataAccess: true, dataAccessWithdrawnAt: WITHDRAWN_AT })),
    ).toBe('unchanged');
  });

  it('refuses a closed request whatever its permission says', () => {
    expect(withdrawalOutcome({ status: 'closed', allowDataAccess: true })).toBe('closed');
    expect(withdrawalOutcome({ status: 'closed', allowDataAccess: false })).toBe('closed');
  });
});
