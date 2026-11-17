// SC-15 / AR-46: specs that prove a service logs no personal data spy on every Nest Logger level
// (the global silencer in silence-logger.ts keeps the output quiet while the spy still sees calls).
import { Logger } from '@nestjs/common';
import { expect, vi } from 'vitest';

export function spyOnLogger(): { loggedText: () => string } {
  const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((level) =>
    vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
  );
  return {
    loggedText: () =>
      spies
        .flatMap((spy) => spy.mock.calls)
        .flat()
        .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join('\n'),
  };
}

export function expectNoneLogged(logged: string, values: string[]): void {
  expect(logged).not.toBe(''); // the spy is wired: something was logged
  for (const value of values) expect(logged).not.toContain(value);
}

const LEVELS = ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const;

/**
 * SPEC-002 BR-002-28 / SC-15: captures EVERYTHING the backend could log during a flow — every Nest
 * Logger level on instances (`new Logger(Name)`, Nest's own ExceptionsHandler included) and the
 * static `Logger.*` calls, plus anything written straight to stdout/stderr (a stray console call
 * or a pino destination) — silently, until `restore()`. The log-scan specs grep it for markers.
 */
export function captureAllLogOutput(): { text: () => string; restore: () => void } {
  const chunks: string[] = [];
  const record = (...args: unknown[]) => {
    for (const arg of args) chunks.push(typeof arg === 'string' ? arg : safeJson(arg));
  };
  const spies = [
    ...LEVELS.map((level) => vi.spyOn(Logger.prototype, level).mockImplementation(record)),
    ...LEVELS.map((level) => vi.spyOn(Logger, level).mockImplementation(record)),
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      record(String(chunk));
      return true;
    }),
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      record(String(chunk));
      return true;
    }),
  ];
  return {
    text: () => chunks.join('\n'),
    restore: () => {
      for (const spy of spies) spy.mockRestore();
    },
  };
}

function safeJson(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
