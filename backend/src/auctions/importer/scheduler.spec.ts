// AR-04 / AR-46: the import job class is only the schedule: it gates on IMPORT_ENABLED, runs each
// tick in its own job context, and the optional startup attempt never leaves an unhandled rejection.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { logContextFields } from '../../common/observability/log-context.js';
import { AuctionsImporter, STARTUP_IMPORT_DELAY_MS } from './scheduler.js';
import { AUCTIONS_IMPORT_JOB } from './import-job.js';
import type { ImportOrchestrator } from './import-orchestrator.service.js';
import type { SchedulerConfig } from '../../config/scheduler.config.js';

function build({ enabled = true, onStartup = false, tickFails = false } = {}) {
  const contexts: Record<string, string>[] = [];
  const orchestrator = {
    tick: vi.fn(async () => {
      contexts.push(logContextFields());
      if (tickFails) throw new Error('boom');
    }),
  };
  const importer = new AuctionsImporter(
    orchestrator as unknown as ImportOrchestrator,
    {
      import: { enabled, onStartup },
    } as SchedulerConfig,
  );
  return { importer, orchestrator, contexts };
}

describe('AuctionsImporter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a scheduled tick asks the orchestrator, in its own job context (AR-46)', async () => {
    const { importer, orchestrator, contexts } = build();

    await importer.tick();

    expect(orchestrator.tick).toHaveBeenCalledWith();
    expect(contexts[0]).toEqual({
      correlationId: expect.any(String),
      jobName: AUCTIONS_IMPORT_JOB,
    });
  });

  it('AR-04: with IMPORT_ENABLED=false a tick does nothing', async () => {
    const { importer, orchestrator } = build({ enabled: false });

    await importer.tick();

    expect(orchestrator.tick).not.toHaveBeenCalled();
  });

  it('does not run on startup unless IMPORT_ON_START_UP is set', async () => {
    const { importer, orchestrator } = build({ onStartup: false });

    importer.onModuleInit();
    await vi.advanceTimersByTimeAsync(STARTUP_IMPORT_DELAY_MS * 2);

    expect(orchestrator.tick).not.toHaveBeenCalled();
  });

  it('does not run on startup when the import is disabled', async () => {
    const { importer, orchestrator } = build({ enabled: false, onStartup: true });

    importer.onModuleInit();
    await vi.advanceTimersByTimeAsync(STARTUP_IMPORT_DELAY_MS * 2);

    expect(orchestrator.tick).not.toHaveBeenCalled();
  });

  it('runs one forced attempt a few seconds after boot with IMPORT_ON_START_UP=true', async () => {
    const { importer, orchestrator, contexts } = build({ onStartup: true });

    importer.onModuleInit();
    expect(orchestrator.tick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(STARTUP_IMPORT_DELAY_MS);

    expect(orchestrator.tick).toHaveBeenCalledWith({ force: true });
    expect(contexts[0]?.jobName).toBe(AUCTIONS_IMPORT_JOB);
  });

  it('catches a failed startup tick: logged, no unhandled rejection', async () => {
    const { importer } = build({ onStartup: true, tickFails: true });
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      importer.onModuleInit();
      await vi.advanceTimersByTimeAsync(STARTUP_IMPORT_DELAY_MS);
      vi.useRealTimers();
      await new Promise((resolve) => setImmediate(resolve));

      expect(warn).toHaveBeenCalledWith('Startup import failed; the schedule will run it again');
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
