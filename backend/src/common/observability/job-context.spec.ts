// AR-46: every job run has its own correlation id and its job name (job-context.ts).
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Cron } from '@nestjs/schedule';
import { logContextFields } from './log-context.js';
import { InJobContext, runInJobContext } from './job-context.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class Jobs {
  readonly seen: Record<string, string>[] = [];

  @Cron('0 3 * * *', { timeZone: 'America/Sao_Paulo' })
  @InJobContext('below-cron')
  async belowCron(value: number): Promise<number> {
    await Promise.resolve();
    this.seen.push(logContextFields());
    return value * 2;
  }

  @InJobContext('above-cron')
  @Cron('0 6 * * *', { timeZone: 'America/Sao_Paulo' })
  aboveCron(): void {
    this.seen.push(logContextFields());
  }
}

describe('runInJobContext (AR-46)', () => {
  it('gives each run a fresh UUID and the job name', async () => {
    const runs = await Promise.all(
      [1, 2].map(() => runInJobContext('auctions-import', async () => logContextFields())),
    );

    expect(runs[0]).toEqual({
      correlationId: expect.stringMatching(UUID),
      jobName: 'auctions-import',
    });
    expect(runs[1]?.correlationId).not.toBe(runs[0]?.correlationId);
    expect(logContextFields()).toEqual({});
  });
});

describe('@InJobContext', () => {
  it('runs each call in its own job context, keeping `this`, arguments and result', async () => {
    const jobs = new Jobs();

    await expect(jobs.belowCron(21)).resolves.toBe(42);
    await jobs.belowCron(1);

    expect(jobs.seen.map((fields) => fields.jobName)).toEqual(['below-cron', 'below-cron']);
    expect(jobs.seen[0]?.correlationId).toMatch(UUID);
    expect(jobs.seen[1]?.correlationId).not.toBe(jobs.seen[0]?.correlationId);
  });

  it('keeps the @Cron metadata @nestjs/schedule reads, above or below @Cron', () => {
    const proto = Jobs.prototype as unknown as Record<string, object>;
    for (const [method, cronTime] of [
      ['belowCron', '0 3 * * *'],
      ['aboveCron', '0 6 * * *'],
    ] as const) {
      const target = proto[method] as object;
      const metadata = (Reflect.getMetadataKeys(target) as unknown[]).map((key) =>
        Reflect.getMetadata(key, target),
      );
      expect(metadata).toContainEqual(expect.objectContaining({ cronTime }));
    }
    expect((proto.aboveCron as { name: string }).name).toBe('aboveCron');
  });

  it('refuses anything but a method', () => {
    const decorate = InJobContext('not-a-method');
    expect(() => decorate({}, 'field', { value: 42 })).toThrow(TypeError);
  });
});
