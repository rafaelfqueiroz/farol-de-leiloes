// AR-03 / SC-15: a failed run's stable code (job-error-code.ts).
import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors/domain-error.js';
import { jobErrorCode, UNKNOWN_JOB_ERROR } from './job-error-code.js';

class MongoServerError extends Error {
  override name = 'MongoServerError';
}

describe('jobErrorCode', () => {
  it("is a DomainError's catalogue code", () => {
    expect(jobErrorCode(new DomainError('NOT_FOUND'))).toBe('NOT_FOUND');
  });

  it("is an error's class name, never its message", () => {
    const error = new MongoServerError('E11000 duplicate key { email: "ana.teste@example.test" }');
    expect(jobErrorCode(error)).toBe('MongoServerError');
    expect(jobErrorCode(new TypeError('x is undefined'))).toBe('TypeError');
  });

  it('is UNKNOWN_ERROR for a non-error or a name that is not a class name', () => {
    expect(jobErrorCode('boom')).toBe(UNKNOWN_JOB_ERROR);
    expect(
      jobErrorCode(Object.assign(new Error('x'), { name: 'failed for ana@example.test' })),
    ).toBe(UNKNOWN_JOB_ERROR);
  });
});
