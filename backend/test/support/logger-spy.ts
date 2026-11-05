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
