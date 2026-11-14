import { describe, expect, it } from 'vitest';
import { scrapeAuctionDetails } from './details-scraper.js';
import { readCaixaFixture } from '../../../test/support/fixtures.js';
import { PaymentMethod } from '../schemas/auction.schema.js';

// AR-23 / TS-11: Caixa's pages show Brasília wall-clock time, so every date is asserted as the UTC
// instant it means (Brasília is UTC-3 since 2019, no daylight saving), whatever zone the test
// host runs in. These assertions used to read the host's local fields, and passed only because
// the parser and the spec shared the same (wrong) host-zone reading.

describe('Details Scraper', () => {
  describe('SFI Auction', () => {
    it('extracts phase dates for 1st and 2nd auction', () => {
      const html = readCaixaFixture('sfi-auction.html');
      const details = scrapeAuctionDetails(html);

      expect(details.phaseDetails).toBeDefined();
      expect(details.phaseDetails?.phaseDates).toBeDefined();
      expect(details.phaseDetails?.phaseDates?.length).toBe(2);

      // "03/03/2026 - 10h00" and "09/03/2026 - 10h00" in Brasília = 13:00 UTC.
      expect(details.phaseDetails?.phaseDates).toEqual([
        new Date('2026-03-03T13:00:00.000Z'),
        new Date('2026-03-09T13:00:00.000Z'),
      ]);
    });

    it('extracts payment methods and expense rules', () => {
      const html = readCaixaFixture('sfi-auction.html');
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
      const html = readCaixaFixture('open-bidding.html');
      const details = scrapeAuctionDetails(html);

      expect(details.phaseDetails).toBeDefined();
      expect(details.phaseDetails?.phaseDates).toBeDefined();
      expect(details.phaseDetails?.phaseDates?.length).toBe(1);

      // "29/01/2026 - 10h00" in Brasília = 13:00 UTC.
      expect(details.phaseDetails?.phaseDates).toEqual([new Date('2026-01-29T13:00:00.000Z')]);
    });
  });

  describe('Online Sales', () => {
    it('extracts end date from strLista in carregaContador()', () => {
      // Fixture strLista contains: "30/01/2026 18:00:00"
      const html = readCaixaFixture('online-sales.html');
      const details = scrapeAuctionDetails(html);

      expect(details.phaseDetails).toBeDefined();
      expect(details.phaseDetails?.phaseDates).toBeDefined();
      expect(details.phaseDetails?.phaseDates?.length).toBe(1);

      // 18:00 in Brasília = 21:00 UTC.
      expect(details.phaseDetails?.phaseDates).toEqual([new Date('2026-01-30T21:00:00.000Z')]);
    });
  });

  describe('Direct Online Sales', () => {
    it('returns empty phase dates array (no end date)', () => {
      const html = readCaixaFixture('direct-online-sales.html');
      const details = scrapeAuctionDetails(html);

      expect(details.phaseDetails).toBeDefined();
      expect(details.phaseDetails?.phaseDates).toBeDefined();
      expect(details.phaseDetails?.phaseDates?.length).toBe(0);
    });
  });

  describe('Unavailable property', () => {
    it('returns unavailable when property is no longer for sale', () => {
      const html = readCaixaFixture('unavailable-property.html');
      const details = scrapeAuctionDetails(html);

      expect(details.unavailable).toBe(true);
      expect(details.imageUrl).toBeUndefined();
      expect(details.description).toBeUndefined();
      expect(details.phaseDetails).toBeUndefined();
    });
  });

  describe('Common extractions', () => {
    it('extracts image URL', () => {
      const html = readCaixaFixture('sfi-auction.html');
      const details = scrapeAuctionDetails(html);

      expect(details.imageUrl).toBeDefined();
      expect(details.imageUrl).toContain('https://venda-imoveis.caixa.gov.br');
    });

    it('extracts description', () => {
      const html = readCaixaFixture('sfi-auction.html');
      const details = scrapeAuctionDetails(html);

      expect(details.description).toBeDefined();
      expect(details.description?.length).toBeGreaterThan(0);
    });
  });
});
