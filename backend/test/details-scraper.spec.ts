import * as fs from 'fs';
import * as path from 'path';
import { scrapeAuctionDetails } from '../src/auctions/scraper/details-scraper';
import { PaymentMethod } from '../src/auctions/schemas/auction.schema';

describe('Details Scraper', () => {
  describe('SFI Auction', () => {
    it('extracts phase dates for 1st and 2nd auction', () => {
      const fixturePath = path.join(__dirname, 'fixtures', 'sfi-auction.html');
      const html = fs.readFileSync(fixturePath, 'utf8');
      const details = scrapeAuctionDetails(html);

      expect(details.phaseDetails).toBeDefined();
      expect(details.phaseDetails?.phaseDates).toBeDefined();
      expect(details.phaseDetails?.phaseDates?.length).toBe(2);

      const firstDate = details.phaseDetails?.phaseDates?.[0];
      expect(firstDate).toBeInstanceOf(Date);
      expect(firstDate?.getDate()).toBe(3);
      expect(firstDate?.getMonth()).toBe(2); // January (0-indexed)
      expect(firstDate?.getFullYear()).toBe(2026);
      expect(firstDate?.getHours()).toBe(10);
      expect(firstDate?.getMinutes()).toBe(0);

      const secondDate = details.phaseDetails?.phaseDates?.[1];
      expect(secondDate).toBeInstanceOf(Date);
      expect(secondDate?.getDate()).toBe(9);
      expect(secondDate?.getMonth()).toBe(2);
      expect(secondDate?.getFullYear()).toBe(2026);
      expect(secondDate?.getHours()).toBe(10);
      expect(secondDate?.getMinutes()).toBe(0);
    });

    it('extracts payment methods and expense rules', () => {
      const fixturePath = path.join(__dirname, 'fixtures', 'sfi-auction.html');
      const html = fs.readFileSync(fixturePath, 'utf8');
      const details = scrapeAuctionDetails(html);

      expect(details.phaseDetails?.paymentMethods).toBeDefined();
      expect(details.phaseDetails?.paymentMethods).toContain(PaymentMethod.OWN_RESOURCES);
      expect(details.phaseDetails?.paymentMethods).toContain(PaymentMethod.FGTS);

      expect(details.phaseDetails?.expenseRules).toBeDefined();
      expect(details.phaseDetails?.expenseRules?.length).toBeGreaterThan(0);
    });
  });

  describe('Open Bidding', () => {
    it('extracts phase date for open bidding auction', () => {
      const fixturePath = path.join(__dirname, 'fixtures', 'open-bidding.html');
      const html = fs.readFileSync(fixturePath, 'utf8');
      const details = scrapeAuctionDetails(html);

      expect(details.phaseDetails).toBeDefined();
      expect(details.phaseDetails?.phaseDates).toBeDefined();
      expect(details.phaseDetails?.phaseDates?.length).toBe(1);

      const date = details.phaseDetails?.phaseDates?.[0];
      expect(date).toBeInstanceOf(Date);
      expect(date?.getDate()).toBe(29);
      expect(date?.getMonth()).toBe(0); // January
      expect(date?.getFullYear()).toBe(2026);
      expect(date?.getHours()).toBe(10);
      expect(date?.getMinutes()).toBe(0);
    });
  });

  describe('Online Sales', () => {
    it('extracts end date from countdown timer', () => {
      const fixturePath = path.join(__dirname, 'fixtures', 'online-sales.html');
      const html = fs.readFileSync(fixturePath, 'utf8');
      const details = scrapeAuctionDetails(html);

      expect(details.phaseDetails).toBeDefined();
      expect(details.phaseDetails?.phaseDates).toBeDefined();
      expect(details.phaseDetails?.phaseDates?.length).toBe(1);

      const endDate = details.phaseDetails?.phaseDates?.[0];
      expect(endDate).toBeInstanceOf(Date);
      // The date should be in the future
      expect(endDate?.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('Direct Online Sales', () => {
    it('returns empty phase dates array (no end date)', () => {
      const fixturePath = path.join(__dirname, 'fixtures', 'direct-online-sales.html');
      const html = fs.readFileSync(fixturePath, 'utf8');
      const details = scrapeAuctionDetails(html);

      expect(details.phaseDetails).toBeDefined();
      expect(details.phaseDetails?.phaseDates).toBeDefined();
      expect(details.phaseDetails?.phaseDates?.length).toBe(0);
    });
  });

  describe('Common extractions', () => {
    it('extracts image URL', () => {
      const fixturePath = path.join(__dirname, 'fixtures', 'sfi-auction.html');
      const html = fs.readFileSync(fixturePath, 'utf8');
      const details = scrapeAuctionDetails(html);

      expect(details.imageUrl).toBeDefined();
      expect(details.imageUrl).toContain('https://venda-imoveis.caixa.gov.br');
    });

    it('extracts description', () => {
      const fixturePath = path.join(__dirname, 'fixtures', 'sfi-auction.html');
      const html = fs.readFileSync(fixturePath, 'utf8');
      const details = scrapeAuctionDetails(html);

      expect(details.description).toBeDefined();
      expect(details.description?.length).toBeGreaterThan(0);
    });
  });
});
