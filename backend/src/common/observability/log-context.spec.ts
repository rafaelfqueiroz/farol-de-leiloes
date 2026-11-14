// AR-46: the log context every line copies (log-context.ts).
import { describe, expect, it } from 'vitest';
import {
  currentLogContext,
  logContextFields,
  runWithLogContext,
  setLogUserHash,
} from './log-context.js';

describe('log context (AR-46)', () => {
  it('adds nothing outside a context', () => {
    expect(currentLogContext()).toBeUndefined();
    expect(logContextFields()).toEqual({});
  });

  it('carries the correlation id across awaits', async () => {
    await runWithLogContext({ correlationId: 'req-12345678' }, async () => {
      await Promise.resolve();
      expect(logContextFields()).toEqual({ correlationId: 'req-12345678' });
    });
    expect(currentLogContext()).toBeUndefined();
  });

  it('adds the job name of a job context', () => {
    runWithLogContext({ correlationId: 'job-12345678', jobName: 'auctions-import' }, () => {
      expect(logContextFields()).toEqual({
        correlationId: 'job-12345678',
        jobName: 'auctions-import',
      });
    });
  });

  it('attaches the user hash for the rest of the context', async () => {
    await runWithLogContext({ correlationId: 'req-12345678' }, async () => {
      setLogUserHash('0123456789abcdef');
      await Promise.resolve();
      expect(logContextFields()).toEqual({
        correlationId: 'req-12345678',
        userHash: '0123456789abcdef',
      });
    });
  });

  it('ignores an absent hash (no LOG_HASH_SECRET) and a call outside any context', () => {
    setLogUserHash('0123456789abcdef');
    expect(currentLogContext()).toBeUndefined();

    runWithLogContext({ correlationId: 'req-12345678' }, () => {
      setLogUserHash(undefined);
      expect(logContextFields()).toEqual({ correlationId: 'req-12345678' });
    });
  });

  it('gives each run its own copy, so one request never sees another user', () => {
    const shared = { correlationId: 'req-12345678' };
    runWithLogContext(shared, () => setLogUserHash('0123456789abcdef'));
    runWithLogContext(shared, () => {
      expect(logContextFields()).toEqual({ correlationId: 'req-12345678' });
    });
  });
});
