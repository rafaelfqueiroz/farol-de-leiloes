// TS-07 / TS-28: the detail-page fetch never reaches the live Caixa site in tests. Navigation is
// stubbed and the page body is a captured fixture from test/fixtures/caixa/.
//
// TS-03: puppeteer has no port yet, so it is the one module replaced with vi.mock here.
// The CaixaSource port arrives with SPEC-004 (#4); this spec then moves to a hand-written fake.
import { describe, expect, it, type Mock, vi } from 'vitest';
import puppeteer from 'puppeteer';
import { fetchAndCheckAvailability } from './details-scraper';
import { readCaixaFixture } from '../../../test/support/fixtures';

vi.mock('puppeteer', () => ({
  default: { launch: vi.fn() },
}));

// Never requested: navigation is stubbed. Shaped like a real detail URL for realism only.
const URL = 'https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=1';

const OK = { ok: () => true, status: () => 200 };

function mockBrowser(
  response: { ok: () => boolean; status: () => number } | null,
  html = '<html></html>',
) {
  const close = vi.fn();
  const page = {
    goto: vi.fn().mockResolvedValue(response),
    content: vi.fn().mockResolvedValue(html),
  };
  (puppeteer.launch as Mock).mockResolvedValue({
    newPage: vi.fn().mockResolvedValue(page),
    close,
  });
  return { close };
}

describe('fetchAndCheckAvailability', () => {
  describe('navigation checks', () => {
    it('throws on an unsuccessful HTTP status and closes the browser', async () => {
      const { close } = mockBrowser({ ok: () => false, status: () => 503 });

      await expect(fetchAndCheckAvailability(URL)).rejects.toThrow('HTTP error! status: 503');
      expect(close).toHaveBeenCalled();
    });

    it('throws when navigation returns no response', async () => {
      mockBrowser(null);

      await expect(fetchAndCheckAvailability(URL)).rejects.toThrow(
        'No response received from navigation',
      );
    });
  });

  describe('availability from the page body', () => {
    it('returns true for an available auction on a 200 response', async () => {
      mockBrowser(OK, readCaixaFixture('sfi-auction.html'));

      await expect(fetchAndCheckAvailability(URL)).resolves.toBe(true);
    });

    it('returns false for the captured "no longer available" page', async () => {
      const { close } = mockBrowser(OK, readCaixaFixture('unavailable-property.html'));

      await expect(fetchAndCheckAvailability(URL)).resolves.toBe(false);
      expect(close).toHaveBeenCalled();
    });

    // TS-12 / SPEC-004 BR-004-20: the bot-protection page stops the run instead of being read
    // as a property page.
    it('rejects the captured bot-protection page and closes the browser', async () => {
      const { close } = mockBrowser(OK, readCaixaFixture('bot-protection.html'));

      await expect(fetchAndCheckAvailability(URL)).rejects.toThrow(
        'Bot protection page detected instead of auction content',
      );
      expect(close).toHaveBeenCalled();
    });
  });
});
