// SPEC-004 SC-24, SC-19: Caixa's HTML is untrusted. A hostile or broken page must cost little and
// must not fill the database. Kept apart from details-scraper.spec.ts on purpose: these are CPU
// assertions that need no time-zone matrix, and run five times at once under coverage on a busy CI
// machine they took longer than the default test timeout (a 1 MiB page parses in about 70 ms plain
// and about 280 ms under coverage instrumentation: linear, but six parses per case add up).
import { describe, expect, it } from 'vitest';
import { scrapeAuctionDetails, type ScrapeResult } from './details-scraper.js';

/** Generous: the shape of the cost is asserted, not a wall-clock bound a loaded machine breaks. */
const CI_TIMEOUT_MS = 60_000;

function pageOf(result: ScrapeResult) {
  if (result.kind !== 'page') throw new Error(`expected a page, got ${result.kind}`);
  return result.page;
}

describe('Details Scraper: a hostile page', () => {
  const MiB = 1024 * 1024;
  const bare = (inner: string) =>
    `<html><body><div class="related-box">${inner}</div></body></html>`;

  it('is refused before it is parsed when it is over the page cap', () => {
    const result = scrapeAuctionDetails(bare('x'.repeat(2 * MiB + 1)));

    expect(result).toEqual({ kind: 'unrecognised' });
  });

  // Timing on a loaded machine is noisy, so the proof is the SHAPE: four times the page costs
  // about four times the time (a pattern that restarts at every position costs sixteen).
  const fastest = (html: string) => {
    const runs = Array.from({ length: 2 }, () => {
      const started = performance.now();
      const result = scrapeAuctionDetails(html);
      expect(result.kind).toBe('page');
      return performance.now() - started;
    });
    return Math.min(...runs);
  };

  it.each([
    ['payment sections that never end', 'FORMAS DE PAGAMENTO ACEITAS:<br>'],
    ['expense sections that never end', 'REGRAS PARA PAGAMENTO DAS DESPESAS (caso existam):<br>'],
    ['open-ended items', '<i class="x"></i>&nbsp;Recursos próprios'],
    ['unclosed item tags', '<i class="x"'],
  ])('is read in linear time for 1 MiB of %s', { timeout: CI_TIMEOUT_MS }, (_, unit) => {
    const page = (bytes: number) => bare(unit.repeat(Math.ceil(bytes / unit.length)));
    const small = fastest(page(MiB / 4));
    const large = fastest(page(MiB));

    expect(large).toBeLessThan(small * 8 + 100); // linear is ~4x; quadratic would be ~16x
    expect(large).toBeLessThan(CI_TIMEOUT_MS / 4); // and never anywhere near a stall
  });

  it('bounds the length of what it keeps: description, type, expense rules', () => {
    const long = 'a'.repeat(100_000);
    const rules = Array.from(
      { length: 500 },
      (_, i) => `<i class="x"></i>&nbsp;Tipo${i}: ${long.slice(0, 2000)}<br>`,
    ).join('');
    const result = scrapeAuctionDetails(
      `<html><body><div class="related-box"><p><strong>Descrição:</strong><br>${long}</p>
        REGRAS PARA PAGAMENTO DAS DESPESAS:<br>${rules}</p></div>
        <span>Tipo de imóvel: <strong>${long}</strong></span></body></html>`,
    );

    const page = pageOf(result);
    expect(page.description?.length).toBeLessThanOrEqual(5000);
    expect(page.propertyType?.length).toBeLessThanOrEqual(80);
    expect(page.expenseRules?.length).toBeLessThanOrEqual(30);
    for (const rule of page.expenseRules ?? []) {
      expect(rule.type.length).toBeLessThanOrEqual(80);
      expect(rule.description.length).toBeLessThanOrEqual(500);
    }
  });

  it('keeps the property type and the expense rules inert, as it does the description (SC-19)', () => {
    const page = pageOf(
      scrapeAuctionDetails(
        `<html><body><div class="related-box">REGRAS PARA PAGAMENTO DAS DESPESAS:<br><i></i>&nbsp;Taxa &amp; <b>x</b>: a &lt;script&gt;<br></p></div>
          <span>Tipo de imóvel: <strong>Casa &amp; &lt;b&gt;</strong></span></body></html>`,
      ),
    );

    expect(page.propertyType).toBe('Casa &amp; &lt;b&gt;');
    for (const rule of page.expenseRules ?? [])
      expect(`${rule.type}${rule.description}`).not.toMatch(/[<>]/);
  });

  it('keeps a gallery of exactly 100, and caps one of 101', () => {
    const gallery = (n: number) =>
      bare(
        `<div class="thumbnails">${Array.from({ length: n }, (_, i) => `<img src="/fotos/F${i}.jpg">`).join('')}</div>`,
      );

    expect(pageOf(scrapeAuctionDetails(gallery(100))).photoUrls).toHaveLength(100);
    expect(pageOf(scrapeAuctionDetails(gallery(101))).photoUrls).toHaveLength(100);
  });
});
