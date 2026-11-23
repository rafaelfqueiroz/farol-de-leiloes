// SPEC-004 / ADR-003 / SC-16: the settings of the Caixa import foundation. A bad value stops the
// boot and the message never echoes it (a proxy URL may carry credentials).
import { describe, expect, it } from 'vitest';
import { TEST_ENV, testEnv } from '../../test/support/test-env.js';
import { validateEnv } from './env.js';
import { businessConfigFrom } from './business.config.js';
import { caixaConfigFrom } from './caixa.config.js';

function errorOf(overrides: Record<string, string | undefined>): string {
  try {
    validateEnv({ ...TEST_ENV, ...overrides });
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected validateEnv to throw');
}

describe('Caixa access settings', () => {
  it('default to a direct connection, 30 s and 20 MiB', () => {
    expect(caixaConfigFrom(testEnv())).toEqual({
      requestTimeoutMs: 30_000,
      maxDownloadBytes: 20 * 1024 * 1024,
    });
  });

  it('read the proxy, the timeout and the size cap as written', () => {
    expect(
      caixaConfigFrom(
        testEnv({
          CAIXA_PROXY_URL: 'http://proxy.example.test:8080',
          CAIXA_REQUEST_TIMEOUT_MS: '5000',
          CAIXA_MAX_DOWNLOAD_BYTES: '1000',
        }),
      ),
    ).toEqual({
      proxyUrl: 'http://proxy.example.test:8080',
      requestTimeoutMs: 5000,
      maxDownloadBytes: 1000,
    });
    expect(
      caixaConfigFrom(testEnv({ CAIXA_PROXY_URL: 'https://p.example.test:3128' })).proxyUrl,
    ).toBe('https://p.example.test:3128');
  });

  it('treat an empty proxy as unset', () => {
    expect(caixaConfigFrom(testEnv({ CAIXA_PROXY_URL: '' })).proxyUrl).toBeUndefined();
  });

  it.each(['socks5://user:hunter2@127.0.0.1:40000', 'socks4://127.0.0.1:1', 'socks5h://h:1'])(
    'refuses a SOCKS proxy with a clear error and never echoes it (%s)',
    (value) => {
      const message = errorOf({ CAIXA_PROXY_URL: value });
      expect(message).toContain('CAIXA_PROXY_URL:');
      expect(message).toContain('SOCKS');
      expect(message).not.toContain('hunter2');
      expect(message).not.toContain('127.0.0.1');
    },
  );

  it.each(['ftp://proxy.example.test', 'not a url', 'proxy.example.test:8080'])(
    'refuses a proxy that is not http(s) (%s)',
    (value) => {
      expect(errorOf({ CAIXA_PROXY_URL: value })).toContain('CAIXA_PROXY_URL:');
    },
  );

  it('bounds the timeout at 120 s and the size cap at 100 MiB, and accepts the bounds', () => {
    expect(caixaConfigFrom(testEnv({ CAIXA_REQUEST_TIMEOUT_MS: '120000' })).requestTimeoutMs).toBe(
      120_000,
    );
    expect(errorOf({ CAIXA_REQUEST_TIMEOUT_MS: '120001' })).toContain('CAIXA_REQUEST_TIMEOUT_MS:');
    const max = 100 * 1024 * 1024;
    expect(
      caixaConfigFrom(testEnv({ CAIXA_MAX_DOWNLOAD_BYTES: String(max) })).maxDownloadBytes,
    ).toBe(max);
    expect(errorOf({ CAIXA_MAX_DOWNLOAD_BYTES: String(max + 1) })).toContain(
      'CAIXA_MAX_DOWNLOAD_BYTES:',
    );
  });

  it.each(['CAIXA_REQUEST_TIMEOUT_MS', 'CAIXA_MAX_DOWNLOAD_BYTES'])(
    '%s is a positive integer',
    (key) => {
      for (const bad of ['0', '-1', '1.5', 'slow']) {
        expect(errorOf({ [key]: bad })).toContain(`${key}:`);
      }
    },
  );
});

describe('IMPORT_MIN_ROW_RATIO (BR-004-04)', () => {
  it('defaults to 0.8 and reads a ratio in (0, 1]', () => {
    expect(businessConfigFrom(testEnv()).import.minRowRatio).toBe(0.8);
    expect(businessConfigFrom(testEnv({ IMPORT_MIN_ROW_RATIO: '0.5' })).import.minRowRatio).toBe(
      0.5,
    );
    expect(businessConfigFrom(testEnv({ IMPORT_MIN_ROW_RATIO: '1' })).import.minRowRatio).toBe(1);
  });

  it.each(['0', '-0.1', '1.01', '80', 'most'])('refuses %s', (bad) => {
    expect(errorOf({ IMPORT_MIN_ROW_RATIO: bad })).toContain('IMPORT_MIN_ROW_RATIO:');
  });
});

describe('NATIONAL_HOLIDAYS (BR-004-31)', () => {
  const holidays = (value: string | undefined) =>
    businessConfigFrom(testEnv({ NATIONAL_HOLIDAYS: value })).calendar.nationalHolidays;

  it('is empty by default and when empty', () => {
    expect(holidays(undefined)).toEqual([]);
    expect(holidays('')).toEqual([]);
  });

  it('reads comma-separated days, trimmed, de-duplicated and sorted', () => {
    expect(holidays(' 2026-12-25, 2026-11-20,2026-12-25 ,,2027-01-01')).toEqual([
      '2026-11-20',
      '2026-12-25',
      '2027-01-01',
    ]);
  });

  it.each(['2026-02-30', '25/12/2026', '2026-12-25;2026-12-26', 'natal'])(
    'refuses the invalid entry %s at config validation, naming its position only',
    (bad) => {
      const message = errorOf({ NATIONAL_HOLIDAYS: `2026-12-25,${bad}` });
      expect(message).toContain('NATIONAL_HOLIDAYS:');
      expect(message).toContain('entry 2');
      expect(message).not.toContain(bad);
    },
  );
});
