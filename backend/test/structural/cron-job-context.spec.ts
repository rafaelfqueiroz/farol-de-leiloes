// AR-46: every log line carries a request or job correlation id. A @Cron method runs outside any
// request, so each one also carries @InJobContext (src/common/observability/job-context.ts),
// which gives every run its own correlation id and job name. Same reading of the sources as
// cron-time-zone.spec.ts.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC = join(import.meta.dirname, '..', '..', 'src');

/** The decorator stack of each method: consecutive `@Name(...)` lines above its signature. */
function decoratorStacks(source: string): string[] {
  return [
    ...source.matchAll(/(?:^[ \t]*@\w+\([^)]*\)[^\n]*\n)+(?=[ \t]*(?:async\s+)?\w+\s*\()/gm),
  ].map((match) => match[0]);
}

function cronCount(source: string): number {
  return [...source.matchAll(/@Cron\(/g)].length;
}

function hasJobContext(stack: string): boolean {
  return /@InJobContext\(/.test(stack);
}

function sources(): { file: string; source: string }[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .map((file) => ({ file, source: readFileSync(join(SRC, file), 'utf8') }));
}

function cronStacks(): { file: string; stack: string }[] {
  return sources().flatMap(({ file, source }) =>
    decoratorStacks(source)
      .filter((stack) => stack.includes('@Cron('))
      .map((stack) => ({ file, stack })),
  );
}

describe('AR-46: every @Cron run has its own job correlation id', () => {
  it('finds every @Cron in a method decorator stack (import, details scraper, reminders)', () => {
    const total = sources().reduce((sum, { source }) => sum + cronCount(source), 0);
    expect(total).toBeGreaterThanOrEqual(3);
    expect(cronStacks()).toHaveLength(total);
  });

  it('decorates every @Cron method with @InJobContext', () => {
    const missing = cronStacks().filter(({ stack }) => !hasJobContext(stack));

    expect(missing).toEqual([]);
  });
});

describe('job context checks', () => {
  it('reads each method decorator stack and whether it opens a job context', () => {
    const source = [
      'class Jobs {',
      "  @Cron('0 6 * * *', { timeZone: BRASILIA_TIME_ZONE })",
      "  @InJobContext('scraper') // AR-46",
      '  async withContext() {}',
      '',
      "  @Cron('*/15 * * * *', { timeZone: BRASILIA_TIME_ZONE })",
      '  withoutContext() {}',
      '}',
    ].join('\n');

    const stacks = decoratorStacks(source);
    expect(stacks).toHaveLength(2);
    expect(stacks.map(hasJobContext)).toEqual([true, false]);
    expect(cronCount(source)).toBe(2);
  });
});
