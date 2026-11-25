import { describe, expect, it } from 'vitest';
import {
  allowedChange,
  fitsStatus,
  isOwnAccount,
  NOTE_LENGTH,
  REASON_LENGTH,
} from './account-status-change.js';

describe('BR-009-19: an admin and their own account', () => {
  it('is the same account when the ids are equal', () => {
    expect(isOwnAccount('64b000000000000000000001', '64b000000000000000000001')).toBe(true);
  });

  it('is the same account whatever the letter case of the id typed: the database reads both as one', () => {
    expect(isOwnAccount('64b0000000000000000000ab', '64B0000000000000000000AB')).toBe(true);
    expect(isOwnAccount('64b0000000000000000000ab', '64b0000000000000000000aB')).toBe(true);
  });

  it('is another account when they differ, even by one character', () => {
    expect(isOwnAccount('64b000000000000000000001', '64b000000000000000000002')).toBe(false);
  });
});

describe('BR-009-15, BR-009-17, BR-009-21: what may be done to an account in each status', () => {
  it.each([
    ['active', 'deactivated'],
    ['deactivated', 'reactivated'],
  ] as const)('a %s account may be %s, and nothing else', (status, action) => {
    expect(allowedChange(status)).toBe(action);
  });

  it.each(['closed', 'pending', '', 'anything'])('a %s account takes no change', (status) => {
    expect(allowedChange(status)).toBeNull();
  });

  it('deactivating fits an active account only; reactivating fits a deactivated one only', () => {
    expect(fitsStatus('deactivated', 'active')).toBe(true);
    expect(fitsStatus('deactivated', 'deactivated')).toBe(false); // an exact repeat is a conflict
    expect(fitsStatus('reactivated', 'deactivated')).toBe(true);
    expect(fitsStatus('reactivated', 'active')).toBe(false);
    expect(fitsStatus('deactivated', 'closed')).toBe(false);
    expect(fitsStatus('reactivated', 'closed')).toBe(false);
    expect(fitsStatus('deactivated', 'pending')).toBe(false);
  });
});

describe('BR-009-15, BR-009-17: the limits of the reason and the note', () => {
  it('holds a reason of 3 to 500 characters and a note up to 500', () => {
    expect(REASON_LENGTH).toEqual({ min: 3, max: 500 });
    expect(NOTE_LENGTH).toEqual({ max: 500 });
  });
});
