// The details scraper's job: the schedule switches, which auctions it picks, and what it writes
// back for each page it reads. TS-07: Caixa is never reached. fetchAndScrapeDetails drives a real
// browser and has no port, so it is the one vi.mock here (TS-03, commented); the page parsing
// itself is covered by details-scraper.spec.ts. Storage is a fake, time is a FakeClock (TS-06),
// and the pause between groups runs on fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { AuctionDetailsScraper, DETAILS_SCRAPER_JOB } from './scraper-scheduler.js';
import { fetchAndScrapeDetails, type ScrapedDetails } from './details-scraper.js';
import { FakeClock, DEFAULT_FAKE_NOW } from '../../../test/fakes/fake-clock.js';
import { spyOnLogger } from '../../../test/support/logger-spy.js';
import { PaymentMethod, PhaseModality } from '../schemas/auction.schema.js';
import { RunMode } from '../../common/job-execution.js';

vi.mock('./details-scraper.js', () => ({ fetchAndScrapeDetails: vi.fn() }));
vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn() }));

type Deps = ConstructorParameters<typeof AuctionDetailsScraper>;

interface Candidate {
  code: string;
  detailsUrl?: string | null;
  description?: string;
  image?: { publicUrl?: string };
  matricula?: { publicUrl?: string };
  phases?: Record<string, unknown>[];
}

const NOW = DEFAULT_FAKE_NOW;

function aCandidate(n: number, overrides: Partial<Candidate> = {}): Candidate {
  return { code: `A${n}`, detailsUrl: `https://caixa.test/detalhe/${n}`, ...overrides };
}

function build(
  found: Candidate[] | Error,
  opts: {
    scraper?: { enabled: boolean; onStartup: boolean };
    storage?: Record<string, unknown>;
    ranRecently?: boolean;
  } = {},
) {
  const find = vi.fn().mockReturnValue({
    lean: () => (found instanceof Error ? Promise.reject(found) : Promise.resolve(found)),
  });
  const auctionModel = { find, updateOne: vi.fn().mockResolvedValue({}) };
  const jobExecutions = {
    hasRunRecently: vi.fn().mockResolvedValue(opts.ranRecently ?? false),
    recordExecution: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
  };
  const storage = {
    isConfigured: vi.fn().mockReturnValue(false),
    uploadImageFromUrl: vi.fn().mockResolvedValue(null),
    uploadDocumentFromUrl: vi.fn().mockResolvedValue(null),
    ...opts.storage,
  };
  const scraper = new AuctionDetailsScraper(
    auctionModel as unknown as Deps[0],
    jobExecutions as unknown as Deps[1],
    storage as unknown as Deps[2],
    { scraper: opts.scraper ?? { enabled: true, onStartup: false } } as unknown as Deps[3],
    new FakeClock(NOW),
  );
  return { scraper, auctionModel, jobExecutions, storage };
}

/** Runs the daily job to its end, releasing the pauses between groups. */
async function runDaily(scraper: AuctionDetailsScraper): Promise<void> {
  const done = scraper.dailyScraperJob();
  await vi.runAllTimersAsync();
  await done;
}

const scraped = (details: ScrapedDetails) =>
  vi.mocked(fetchAndScrapeDetails).mockResolvedValue(details);

beforeEach(() => {
  vi.useFakeTimers();
  scraped({});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AuctionDetailsScraper.onModuleInit', () => {
  it('says it is disabled and schedules nothing when SCRAPER_ENABLED is off', async () => {
    const logger = spyOnLogger();
    const { scraper, auctionModel } = build([], { scraper: { enabled: false, onStartup: true } });

    await scraper.onModuleInit();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(logger.loggedText()).toContain('Scraper is disabled');
    expect(auctionModel.find).not.toHaveBeenCalled();
  });

  it('only waits for the schedule when SCRAPER_ON_START_UP is off', async () => {
    const logger = spyOnLogger();
    const { scraper, auctionModel } = build([], { scraper: { enabled: true, onStartup: false } });

    await scraper.onModuleInit();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(logger.loggedText()).toContain('Skipping startup scraper');
    expect(auctionModel.find).not.toHaveBeenCalled();
  });

  it('runs a manual pass five seconds after start when SCRAPER_ON_START_UP is on', async () => {
    const { scraper, auctionModel, jobExecutions } = build([], {
      scraper: { enabled: true, onStartup: true },
    });

    await scraper.onModuleInit();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(auctionModel.find).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(auctionModel.find).toHaveBeenCalledTimes(1);
    expect(jobExecutions.recordExecution).toHaveBeenCalledWith(DETAILS_SCRAPER_JOB, RunMode.MANUAL);
  });
});

describe('AuctionDetailsScraper.dailyScraperJob', () => {
  it('skips the run when the scraper is disabled', async () => {
    const { scraper, jobExecutions, auctionModel } = build([aCandidate(1)], {
      scraper: { enabled: false, onStartup: false },
    });

    await runDaily(scraper);

    expect(jobExecutions.hasRunRecently).not.toHaveBeenCalled();
    expect(auctionModel.find).not.toHaveBeenCalled();
  });

  it('skips the run when it already succeeded within the last 23 hours', async () => {
    const { scraper, jobExecutions, auctionModel } = build([aCandidate(1)], { ranRecently: true });

    await runDaily(scraper);

    expect(jobExecutions.hasRunRecently).toHaveBeenCalledWith(
      DETAILS_SCRAPER_JOB,
      RunMode.AUTO,
      23,
    );
    expect(auctionModel.find).not.toHaveBeenCalled();
  });

  it('asks for auctions with a details URL that are not fulfilled yet', async () => {
    const { scraper, auctionModel } = build([]);

    await runDaily(scraper);

    const query = auctionModel.find.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(query).sort()).toEqual(['$or', 'detailsUrl']);
  });

  it('records a success without scraping when there is nothing to scrape', async () => {
    const logger = spyOnLogger();
    const { scraper, jobExecutions } = build([]);

    await runDaily(scraper);

    expect(logger.loggedText()).toContain('No auctions to scrape');
    expect(fetchAndScrapeDetails).not.toHaveBeenCalled();
    expect(jobExecutions.recordExecution).toHaveBeenCalledWith(DETAILS_SCRAPER_JOB, RunMode.AUTO);
  });

  it('tallies scraped auctions and errors, and carries on after a page that fails', async () => {
    const logger = spyOnLogger();
    const { scraper, auctionModel, jobExecutions } = build([
      aCandidate(1),
      aCandidate(2),
      aCandidate(3),
    ]);
    vi.mocked(fetchAndScrapeDetails)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new TypeError('page changed'))
      .mockResolvedValueOnce({});

    await runDaily(scraper);

    expect(auctionModel.updateOne).toHaveBeenCalledTimes(2);
    expect(logger.loggedText()).toContain('Error scraping auction A2: TypeError');
    expect(logger.loggedText()).not.toContain('page changed');
    expect(logger.loggedText()).toContain('Scraping completed: 2 images scraped, 1 errors');
    expect(jobExecutions.recordExecution).toHaveBeenCalledTimes(1);
  });

  it('works through 20 auctions in batches of 15 and groups of 3, pausing 500 ms between groups', async () => {
    const logger = spyOnLogger();
    const candidates = Array.from({ length: 20 }, (_, i) => aCandidate(i + 1));
    const { scraper } = build(candidates);

    const done = scraper.dailyScraperJob();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchAndScrapeDetails).toHaveBeenCalledTimes(3); // first group
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchAndScrapeDetails).toHaveBeenCalledTimes(6); // second group, 500 ms later
    await vi.runAllTimersAsync();
    await done;

    expect(fetchAndScrapeDetails).toHaveBeenCalledTimes(20);
    expect(logger.loggedText()).toContain('Processing batch 1/2');
    expect(logger.loggedText()).toContain('Processing batch 2/2');
  });

  it('records the run as failed and rethrows when the query itself fails', async () => {
    const logger = spyOnLogger();
    const { scraper, jobExecutions } = build(new TypeError('db down'));

    const done = scraper.dailyScraperJob();
    const outcome = expect(done).rejects.toBeInstanceOf(TypeError);
    await vi.runAllTimersAsync();
    await outcome;

    expect(logger.loggedText()).toContain('Failed to scrape auction details: TypeError');
    expect(jobExecutions.recordExecution).not.toHaveBeenCalled();
    expect(jobExecutions.recordFailure).toHaveBeenCalledWith(
      DETAILS_SCRAPER_JOB,
      RunMode.AUTO,
      'TypeError',
    );
  });
});

describe('AuctionDetailsScraper.processAuction', () => {
  const update = (auctionModel: ReturnType<typeof build>['auctionModel']) =>
    auctionModel.updateOne.mock.calls[0] as [{ code: string }, { $set: Record<string, unknown> }];

  it('skips an auction with no details URL without opening a page', async () => {
    const { scraper, auctionModel } = build([]);

    await expect(
      scraper['processAuction'](aCandidate(1, { detailsUrl: null }) as never),
    ).resolves.toBe(false);

    expect(fetchAndScrapeDetails).not.toHaveBeenCalled();
    expect(auctionModel.updateOne).not.toHaveBeenCalled();
  });

  it('marks an auction Caixa no longer sells as unavailable and fulfilled', async () => {
    scraped({ unavailable: true });
    const { scraper, auctionModel } = build([]);

    await expect(scraper['processAuction'](aCandidate(1) as never)).resolves.toBe(true);

    expect(update(auctionModel)).toEqual([
      { code: 'A1' },
      { $set: { available: false, fulfilled: true, updatedAt: NOW } },
    ]);
  });

  it('fulfils an auction and takes the description only when it has none', async () => {
    scraped({ description: 'Casa com quintal' });
    const first = build([]);
    await first.scraper['processAuction'](aCandidate(1) as never);
    expect(update(first.auctionModel)[1]).toEqual({
      $set: { fulfilled: true, updatedAt: NOW, description: 'Casa com quintal' },
    });

    const second = build([]);
    await second.scraper['processAuction'](aCandidate(1, { description: 'kept' }) as never);
    expect(update(second.auctionModel)[1]).toEqual({ $set: { fulfilled: true, updatedAt: NOW } });
  });

  it('copies no file when storage is not configured', async () => {
    scraped({ imageUrl: 'https://caixa.test/f.jpg', matriculaUrl: 'https://caixa.test/m.pdf' });
    const { scraper, auctionModel, storage } = build([]);

    await scraper['processAuction'](aCandidate(1) as never);

    expect(storage.uploadImageFromUrl).not.toHaveBeenCalled();
    expect(storage.uploadDocumentFromUrl).not.toHaveBeenCalled();
    expect(update(auctionModel)[1]).toEqual({ $set: { fulfilled: true, updatedAt: NOW } });
  });

  describe('with storage configured', () => {
    const configured = (extra: Record<string, unknown> = {}) => ({
      storage: { isConfigured: vi.fn().mockReturnValue(true), ...extra },
    });

    it('copies the image and the matrícula and stores where they went', async () => {
      scraped({ imageUrl: 'https://caixa.test/f.jpg', matriculaUrl: 'https://caixa.test/m.pdf' });
      const { scraper, auctionModel, storage } = build(
        [],
        configured({
          uploadImageFromUrl: vi.fn().mockResolvedValue({
            key: 'images/A1.jpg',
            url: 'https://cdn.test/images/A1.jpg',
            size: 10,
          }),
          uploadDocumentFromUrl: vi.fn().mockResolvedValue({
            key: 'documents/A1/matricula.pdf',
            url: 'https://cdn.test/documents/A1/matricula.pdf',
            size: 20,
          }),
        }),
      );

      await scraper['processAuction'](aCandidate(1) as never);

      expect(storage.uploadImageFromUrl).toHaveBeenCalledWith('https://caixa.test/f.jpg', 'A1');
      expect(storage.uploadDocumentFromUrl).toHaveBeenCalledWith(
        'https://caixa.test/m.pdf',
        'A1',
        'matricula',
      );
      expect(update(auctionModel)[1]).toEqual({
        $set: {
          fulfilled: true,
          updatedAt: NOW,
          image: {
            originalUrl: 'https://caixa.test/f.jpg',
            mimeType: 'image/jpeg',
            storageKey: 'images/A1.jpg',
            publicUrl: 'https://cdn.test/images/A1.jpg',
            size: 10,
            uploadedAt: NOW,
          },
          matricula: {
            originalUrl: 'https://caixa.test/m.pdf',
            storageKey: 'documents/A1/matricula.pdf',
            publicUrl: 'https://cdn.test/documents/A1/matricula.pdf',
            mimeType: 'application/pdf',
            size: 20,
            uploadedAt: NOW,
          },
        },
      });
    });

    it('records the original image URL without a copy when the upload fails, and no matrícula', async () => {
      scraped({ imageUrl: 'https://caixa.test/f.jpg', matriculaUrl: 'https://caixa.test/m.pdf' });
      const { scraper, auctionModel } = build([], configured());

      await scraper['processAuction'](aCandidate(1) as never);

      expect(update(auctionModel)[1]).toEqual({
        $set: {
          fulfilled: true,
          updatedAt: NOW,
          image: { originalUrl: 'https://caixa.test/f.jpg', mimeType: 'image/jpeg' },
        },
      });
    });

    it('does not copy files an earlier run already published', async () => {
      scraped({ imageUrl: 'https://caixa.test/f.jpg', matriculaUrl: 'https://caixa.test/m.pdf' });
      const { scraper, storage } = build([], configured());

      await scraper['processAuction'](
        aCandidate(1, {
          image: { publicUrl: 'https://cdn.test/i.jpg' },
          matricula: { publicUrl: 'https://cdn.test/m.pdf' },
        }) as never,
      );

      expect(storage.uploadImageFromUrl).not.toHaveBeenCalled();
      expect(storage.uploadDocumentFromUrl).not.toHaveBeenCalled();
    });
  });

  describe('phase details', () => {
    const phaseDetails = {
      paymentMethods: [PaymentMethod.FGTS],
      expenseRules: [{ type: 'Condomínio', description: 'Até 10%' }],
      phaseDates: [new Date('2026-02-01T13:00:00.000Z')],
    };
    const lastPhase = {
      modality: PhaseModality.SFI_AUCTION,
      minimumPrice: new Types.Decimal128('100'),
    };

    it('adds the scraped details to the last phase and makes it the current one', async () => {
      scraped({ phaseDetails });
      const { scraper, auctionModel } = build([]);
      const earlier = { modality: PhaseModality.OPEN_BIDDING };

      await scraper['processAuction'](aCandidate(1, { phases: [earlier, lastPhase] }) as never);

      const expectedLast = { ...lastPhase, ...phaseDetails };
      expect(update(auctionModel)[1]).toEqual({
        $set: {
          fulfilled: true,
          updatedAt: NOW,
          phases: [earlier, expectedLast],
          currentPhase: expectedLast,
          // BR-004-13: the dates are the property's SFI round(s) too, the page counts as collected.
          rounds: [{ label: '1º Leilão', minimumPrice: null, date: phaseDetails.phaseDates[0] }],
          detailsCollectedAt: NOW,
        },
      });
    });

    it('writes an open-ended round for a direct online sale, which has no end date', async () => {
      scraped({ phaseDetails: { ...phaseDetails, phaseDates: [] } });
      const { scraper, auctionModel } = build([]);
      const direct = { ...lastPhase, modality: PhaseModality.DIRECT_ONLINE_SALES };

      await scraper['processAuction'](aCandidate(1, { phases: [direct] }) as never);

      expect(update(auctionModel)[1].$set['rounds']).toEqual([
        { label: 'Venda Direta', minimumPrice: null, date: null },
      ]);
    });

    it.each([
      ['payment methods', { paymentMethods: [PaymentMethod.FINANCING] }],
      ['expense rules', { expenseRules: [{ type: 'IPTU', description: 'x' }] }],
      ['dates', { phaseDates: [new Date('2026-03-01T13:00:00.000Z')] }],
    ])('leaves a last phase that already has %s as it is', async (_name, existing) => {
      scraped({ phaseDetails });
      const { scraper, auctionModel } = build([]);

      await scraper['processAuction'](
        aCandidate(1, { phases: [{ ...lastPhase, ...existing }] }) as never,
      );

      expect(update(auctionModel)[1]).toEqual({ $set: { fulfilled: true, updatedAt: NOW } });
    });

    it('ignores phase details for an auction with no phases', async () => {
      scraped({ phaseDetails });
      const { scraper, auctionModel } = build([]);

      await scraper['processAuction'](aCandidate(1) as never);

      expect(update(auctionModel)[1]).toEqual({ $set: { fulfilled: true, updatedAt: NOW } });
    });
  });
});
