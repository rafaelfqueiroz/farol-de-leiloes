// SPEC-009 BR-009-14, DL-009-06: every account search and every account record viewed is logged BEFORE
// anything is returned, and a log that cannot be written refuses the lookup (fail closed). SC-15: the
// failure logs no data, and an entry never holds the terms.
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { FakeClock } from '../../test/fakes/fake-clock.js';
import { expectNoneLogged, spyOnLogger } from '../../test/support/logger-spy.js';
import type {
  AdminAccessLogRepository,
  NewAdminAccessLogEntry,
} from './admin-access-log.repository.js';
import { AccountLookupLogger } from './account-lookup-logger.js';
import { AdminAccessLogUnavailableError } from './grant-read-logger.js';

const ADMIN = '64b7f0000000000000000a01';
const ACCOUNT = '64b7f0000000000000000b01';
const KEY = 'a-test-key-that-is-not-a-real-one-0000000';

class RecordingLog {
  entries: NewAdminAccessLogEntry[] = [];
  failWith: unknown = null;

  append(entries: readonly NewAdminAccessLogEntry[]): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.entries.push(...entries);
    return Promise.resolve();
  }
}

function build({ secret }: { secret: string | undefined } = { secret: KEY }) {
  const log = new RecordingLog();
  const clock = new FakeClock(new Date('2099-01-15T12:00:00.000Z'));
  const config = { get: () => secret } as unknown as ConfigService<Env, true>;
  const logger = new AccountLookupLogger(log as unknown as AdminAccessLogRepository, clock, config);
  return { logger, log, clock };
}

afterEach(() => vi.restoreAllMocks());

describe('BR-009-14: a search is logged', () => {
  it('writes ONE entry: the admin, the instant, and kind:length:hmac of the terms, nothing else', async () => {
    const { logger, log } = build();

    await logger.logSearch(ADMIN, { kind: 'name', terms: 'maria silva' });

    const hash = createHmac('sha256', KEY)
      .update('account_search:maria silva')
      .digest('hex')
      .slice(0, 32);
    expect(log.entries).toEqual([
      {
        adminUserId: ADMIN,
        action: 'account_search',
        query: `name:11:${hash}`,
        at: new Date('2099-01-15T12:00:00.000Z'),
      },
    ]);
  });

  it('writes no readable terms when no key is configured', async () => {
    const { logger, log } = build({ secret: undefined });

    await logger.logSearch(ADMIN, { kind: 'email', terms: 'ana@exemplo.test' });

    expect(log.entries[0]?.query).toBe('email:16:-');
  });
});

describe('BR-009-14: a record viewed is logged', () => {
  it('writes ONE entry: the admin, the instant and the account as the resource, no owner and no query', async () => {
    const { logger, log, clock } = build();
    clock.advance(1000);

    await logger.logView(ADMIN, ACCOUNT);

    expect(log.entries).toEqual([
      {
        adminUserId: ADMIN,
        action: 'account_view',
        resource: { type: 'account', id: ACCOUNT },
        at: new Date('2099-01-15T12:00:01.000Z'),
      },
    ]);
  });
});

describe('BR-009-14 / SC-15: fail closed', () => {
  it.each([
    [
      'a search',
      (logger: AccountLookupLogger) => logger.logSearch(ADMIN, { kind: 'name', terms: 'maria' }),
    ],
    ['a view', (logger: AccountLookupLogger) => logger.logView(ADMIN, ACCOUNT)],
  ])(
    '%s that cannot be written is refused with AdminAccessLogUnavailableError, and the log names no data',
    async (_label, run) => {
      const spy = spyOnLogger();
      const { logger, log } = build();
      log.failWith = new Error('E11000 duplicate key maria@exemplo.test');

      await expect(run(logger)).rejects.toBeInstanceOf(AdminAccessLogUnavailableError);

      expect(spy.loggedText()).toContain('BR-009-14: admin access log not written');
      expectNoneLogged(spy.loggedText(), ['maria', 'exemplo', ACCOUNT]);
    },
  );
});
