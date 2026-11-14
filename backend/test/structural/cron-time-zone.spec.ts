// AR-25 / SPEC-003 BR-003-27: every @Cron names its zone, Brasília, so a schedule never depends on
// the zone the server happens to run in.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC = join(import.meta.dirname, '..', '..', 'src');

/** Each `@Cron(...)` call of a source, as written (up to its closing parenthesis). */
function cronDecorators(source: string): string[] {
  return [...source.matchAll(/@Cron\(([^)]*)\)/g)].map((match) => match[0]);
}

function namesBrasiliaZone(decorator: string): boolean {
  return /timeZone:\s*BRASILIA_TIME_ZONE\b/.test(decorator);
}

function cronsInSrc(): { file: string; decorator: string }[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .flatMap((file) =>
      cronDecorators(readFileSync(join(SRC, file), 'utf8')).map((decorator) => ({
        file,
        decorator,
      })),
    );
}

describe('AR-25: cron schedules run in Brasília time', () => {
  it('finds the scheduled jobs (import, details scraper, reminders)', () => {
    expect(cronsInSrc().length).toBeGreaterThanOrEqual(3);
  });

  it('sets timeZone: BRASILIA_TIME_ZONE on every @Cron', () => {
    const missing = cronsInSrc().filter(({ decorator }) => !namesBrasiliaZone(decorator));

    expect(missing).toEqual([]);
  });
});

describe('cron decorator checks', () => {
  it('reads each decorator and whether it names the zone', () => {
    const source = [
      "@Cron('0 6 * * *', { timeZone: BRASILIA_TIME_ZONE })",
      "@Cron('*/15 * * * *')",
    ].join('\n');

    expect(cronDecorators(source).map(namesBrasiliaZone)).toEqual([true, false]);
  });
});
