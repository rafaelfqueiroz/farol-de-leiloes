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
 * SPEC-002 BR-002-28 / SC-15: captures what the backend's code hands to a logger during a flow —
 * every Nest Logger level on instances (`new Logger(Name)`, Nest's own ExceptionsHandler included)
 * and the static `Logger.*` calls, as the ARGUMENTS they were called with — plus anything written
 * straight to stdout/stderr (a stray console call), silently, until `restore()`.
 *
 * What it does NOT see by itself: lines pino builds without a Nest Logger call — pino-http's
 * request completion lines and pino's serialization of an error — because in tests no pino is
 * installed. A spec that needs those boots the production logger (`loggerParams`, nestjs-pino)
 * into an in-memory destination and passes `{ passThrough: true }`, so each Nest Logger call is
 * both recorded here and handed on to pino (test/isolation/log-hygiene.isolation.spec.ts does).
 */
export function captureAllLogOutput(options: { passThrough?: boolean } = {}): {
  text: () => string;
  restore: () => void;
} {
  const chunks: string[] = [];
  const record = (...args: unknown[]) => {
    for (const arg of args) chunks.push(typeof arg === 'string' ? arg : safeJson(arg));
  };
  type LogFn = (this: unknown, ...args: unknown[]) => unknown;
  const recording = (original: LogFn): LogFn =>
    options.passThrough
      ? function (this: unknown, ...args: unknown[]) {
          record(...args);
          return original.apply(this, args);
        }
      : (...args: unknown[]) => {
          record(...args);
        };
  const spies = [
    ...LEVELS.map((level) => {
      const original = Logger.prototype[level] as LogFn;
      return vi.spyOn(Logger.prototype, level).mockImplementation(recording(original) as never);
    }),
    ...LEVELS.map((level) => {
      const original = Logger[level].bind(Logger) as LogFn;
      return vi.spyOn(Logger, level).mockImplementation(recording(original) as never);
    }),
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
