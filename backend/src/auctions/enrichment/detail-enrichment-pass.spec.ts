// SPEC-004 BR-004-18..21: the pass over fakes (TS-07): an in-memory repository, a Caixa fake, fake
// time. The same behaviour against MongoDB, through the orchestrator, is in
// test/integration/detail-collection.spec.ts.
import { describe, expect, it } from 'vitest';
import { FakeCaixaAccess } from '../../../test/fakes/fake-caixa-access.js';
import { FakeClock } from '../../../test/fakes/fake-clock.js';
import { FakeCopyStorage } from '../../../test/fakes/fake-copy-storage.js';
import {
  aCandidate,
  aStoredProperty,
  FakeEnrichmentRepository,
} from '../../../test/fakes/fake-enrichment-repository.js';
import { FakeSleeper } from '../../../test/fakes/fake-sleeper.js';
import { readCaixaFixture } from '../../../test/support/fixtures.js';
import { detailPage } from '../../../test/support/detail-pages.js';
import { captureAllLogOutput } from '../../../test/support/logger-spy.js';
import { testBusinessConfig, testEnv } from '../../../test/support/test-env.js';
import { schedulerConfigFrom } from '../../config/scheduler.config.js';
import { LeaseLostError } from '../import-runs/lease-lost.error.js';
import type { StorageService } from '../../storage/storage.service.js';
import { CaixaBlockedError, CaixaUnreachableError } from '../caixa/caixa-access.js';
import { PhaseModality } from '../domain/modality.js';
import type { PropertyChangeService } from '../changes/property-change.service.js';
import { DetailApplier } from './detail-applier.js';
import { DetailEnrichmentPass } from './detail-enrichment-pass.js';
import type { CollectionResult } from './enrichment-pass.js';
import type { EnrichmentRepository } from './enrichment.repository.js';
import { FileCopier } from './file-copier.js';
import { PropertyCopier } from './property-copier.js';

const START = new Date('2026-11-24T12:00:00.000Z');
const ZERO: CollectionResult = { collected: 0, failed: 0, blocked: false, pages: 0 };
const urlOf = (code: string) =>
  `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=${code}`;
const PAGE = detailPage({
  openBiddingDate: '30/12/2026 - 10h00',
  photos: [],
  edital: null,
  matricula: null,
});

function setup(env: Record<string, string> = {}, codes: string[] = ['0001', '0002', '0003']) {
  const clock = new FakeClock(START);
  const sleeper = new FakeSleeper(clock);
  const repository = new FakeEnrichmentRepository();
  const caixa = new FakeCaixaAccess();
  const business = testBusinessConfig(env);
  const storage = new FakeCopyStorage();
  const applier = new DetailApplier(
    { record: async () => undefined } as unknown as PropertyChangeService,
    repository as unknown as EnrichmentRepository,
  );
  const pass = new DetailEnrichmentPass(
    caixa,
    repository as unknown as EnrichmentRepository,
    new PropertyCopier(new FileCopier(storage as unknown as StorageService, business), business),
    applier,
    clock,
    sleeper,
    schedulerConfigFrom(testEnv(env)),
    business,
  );
  for (const code of codes) {
    repository.candidates.push(aCandidate(code));
    repository.stored.set(code, aStoredProperty(code, { modality: PhaseModality.OPEN_BIDDING }));
    caixa.serveDetailPage(urlOf(code), PAGE);
  }
  const saved: CollectionResult[] = [];
  const run = (
    previous: CollectionResult = ZERO,
    assertHeld: () => Promise<void> = () => Promise.resolve(),
  ) =>
    sleeper.drive(
      pass.run({
        importRunId: '0123456789abcdef01234567',
        brasiliaDate: '2026-11-24',
        previous,
        assertHeld,
        saveProgress: async (progress) => {
          saved.push(progress);
        },
      }),
    );
  return { repository, caixa, run, saved, sleeper };
}

describe('DetailEnrichmentPass', () => {
  it('collects the queued pages, saving the totals after each property', async () => {
    const { repository, caixa, run, saved } = setup();

    const result = await run();

    expect(result).toEqual({ collected: 3, failed: 0, blocked: false, pages: 3 });
    expect(caixa.requests.map((request) => request.kind)).toEqual(['detail', 'detail', 'detail']);
    expect(repository.applied.map((entry) => entry.code)).toEqual(['0001', '0002', '0003']);
    expect(saved.map((progress) => progress.collected)).toEqual([1, 2, 3]);
  });

  it('takes only the budget the day has left, across passes', async () => {
    const { repository, run } = setup({ ENRICHMENT_DAILY_PAGES: '5' });

    const result = await run({ collected: 3, failed: 0, blocked: false, pages: 4 });

    expect(repository.queries).toEqual([{ limit: 1 }]);
    expect(result).toEqual({ collected: 4, failed: 0, blocked: false, pages: 5 });
  });

  it('asks nothing when the budget is spent or Caixa already blocked the day, and nothing when the pass is off', async () => {
    const spent = setup({ ENRICHMENT_DAILY_PAGES: '3' });
    const blocked = setup();
    const off = setup({ SCRAPER_ENABLED: 'false' });
    const previous = { collected: 1, failed: 0, blocked: false, pages: 3 };

    expect(await spent.run(previous)).toEqual(previous);
    expect(await blocked.run({ ...ZERO, blocked: true })).toEqual({ ...ZERO, blocked: true });
    expect(await off.run(previous)).toEqual(previous);
    for (const env of [spent, blocked, off]) expect(env.caixa.requests).toEqual([]);
  });

  it('checks the lease before every request, and a lost lease ends the pass without another request', async () => {
    const { caixa, run } = setup();
    let checks = 0;

    await expect(
      run(ZERO, () =>
        ++checks > 1 ? Promise.reject(new LeaseLostError('lease lost')) : Promise.resolve(),
      ),
    ).rejects.toBeInstanceOf(LeaseLostError);

    expect(caixa.requests).toHaveLength(1);
  });

  it('stops the whole pass on a block, writes nothing for that property and does not count it failed', async () => {
    const { repository, caixa, run, saved } = setup();
    caixa.serveDetailPage(urlOf('0002'), new CaixaBlockedError('HTTP_403'));

    const result = await run();

    expect(result).toEqual({ collected: 1, failed: 0, blocked: true, pages: 2 });
    expect(caixa.requests).toHaveLength(2);
    expect(repository.applied.map((entry) => entry.code)).toEqual(['0001']);
    expect(saved[saved.length - 1]?.blocked).toBe(true);
  });

  it('treats the challenge page as a block', async () => {
    const { caixa, run } = setup();
    caixa.serveDetailPage(urlOf('0001'), readCaixaFixture('bot-protection.html'));

    expect(await run()).toEqual({ collected: 0, failed: 0, blocked: true, pages: 1 });
  });

  it('backs a failed page off, counting the failures in a row', async () => {
    const { repository, caixa, run } = setup({}, ['0001']);
    repository.stored.set('0001', aStoredProperty('0001', { detailsFailures: 2 }));
    caixa.serveDetailPage(urlOf('0001'), new CaixaUnreachableError('TIMEOUT'));

    const result = await run();

    expect(result).toEqual({ collected: 0, failed: 1, blocked: false, pages: 1 });
    // The 3rd failure waits 4 days, until midnight Brasília (2026-11-28T03:00Z).
    expect(repository.failures).toEqual([
      { code: '0001', failures: 3, retryAfter: new Date('2026-11-28T03:00:00.000Z') },
    ]);
  });

  it.each([
    ['an unreadable page', '<html><body>x</body></html>'],
    ['a page that says the property is unavailable', readCaixaFixture('unavailable-property.html')],
  ])('counts %s as a failed fetch', async (_, html) => {
    const { repository, caixa, run } = setup({}, ['0001']);
    caixa.serveDetailPage(urlOf('0001'), html);

    expect((await run()).failed).toBe(1);
    expect(repository.failures).toHaveLength(1);
    expect(repository.applied).toEqual([]);
  });

  it('stops after the configured number of failures in a row, and a success resets the count', async () => {
    const stop = setup({ ENRICHMENT_MAX_CONSECUTIVE_FAILURES: '2' }, [
      '0001',
      '0002',
      '0003',
      '0004',
    ]);
    for (const code of ['0001', '0002', '0003', '0004']) {
      stop.caixa.serveDetailPage(urlOf(code), new CaixaUnreachableError('NETWORK'));
    }
    const reset = setup({ ENRICHMENT_MAX_CONSECUTIVE_FAILURES: '2' }, [
      '0001',
      '0002',
      '0003',
      '0004',
    ]);
    for (const code of ['0001', '0003']) {
      reset.caixa.serveDetailPage(urlOf(code), new CaixaUnreachableError('NETWORK'));
    }

    expect(await stop.run()).toEqual({ collected: 0, failed: 2, blocked: false, pages: 2 });
    expect(await reset.run()).toEqual({ collected: 2, failed: 2, blocked: false, pages: 4 });
  });

  it('counts a fault after the page (the database) as that property failing, by code', async () => {
    const { repository, run } = setup({}, ['0001']);
    repository.failApply = new Error('connection to a database named owner-db lost');
    const capture = captureAllLogOutput();
    try {
      const result = await run();
      expect(result).toEqual({ collected: 0, failed: 1, blocked: false, pages: 1 });
    } finally {
      capture.restore();
    }
    expect(capture.text()).not.toContain('owner-db');
  });

  it('skips a property that vanished, is unavailable or has no page link, without asking Caixa', async () => {
    const { repository, caixa, run } = setup({}, ['0001', '0002', '0003']);
    repository.stored.delete('0001');
    repository.stored.set('0002', aStoredProperty('0002', { available: false }));
    repository.stored.set('0003', aStoredProperty('0003', { detailsUrl: null }));

    expect(await run()).toEqual(ZERO);
    expect(caixa.requests).toEqual([]);
  });

  it('runs workers side by side up to the configured concurrency, still pausing between starts', async () => {
    const { caixa, run, sleeper } = setup(
      { ENRICHMENT_CONCURRENCY: '2', ENRICHMENT_MIN_PAUSE_MS: '1000' },
      ['0001', '0002', '0003', '0004'],
    );

    const result = await run();

    expect(result.collected).toBe(4);
    expect(caixa.requests).toHaveLength(4);
    expect(sleeper.sleeps).toEqual([1000, 1000, 1000]);
  });

  it('logs one structured line per request without a URL', async () => {
    const { run } = setup({ ENRICHMENT_MIN_PAUSE_MS: '2000' }, ['0001', '0002']);
    const capture = captureAllLogOutput();
    try {
      await run();
    } finally {
      capture.restore();
    }

    const lines = capture
      .text()
      .split('\n')
      .filter((line) => line.includes('collection.request'));
    expect(lines).toEqual([
      'collection.request kind=page code=0001 outcome=OK startMs=0 endMs=0',
      'collection.request kind=page code=0002 outcome=OK startMs=2000 endMs=2000',
    ]);
  });

  it('reports a request that fails by code in the log line', async () => {
    const { caixa, run } = setup({}, ['0001']);
    caixa.serveDetailPage(urlOf('0001'), new CaixaUnreachableError('TIMEOUT'));
    const capture = captureAllLogOutput();
    try {
      await run();
    } finally {
      capture.restore();
    }

    expect(capture.text()).toContain('outcome=UNREACHABLE_TIMEOUT');
  });
});
