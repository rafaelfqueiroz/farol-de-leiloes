import { describe, expect, it } from 'vitest';
import { scrapeAuctionDetails, type ScrapeResult } from './details-scraper.js';
import { readCaixaFixture } from '../../../test/support/fixtures.js';
import { PaymentMethod } from '../domain/detail-data.js';
import { Decimal } from '../../common/money/money.js';

// AR-23 / TS-11: Caixa's pages show Brasília wall-clock time, so every date is asserted as the UTC
// instant it means (Brasília is UTC-3 since 2019, no daylight saving), whatever zone the test
// host runs in; this spec runs in the zone matrix (vitest.config.mts).
//
// The fixtures hold no owner, no CPF and no matrícula text (SC-15, TS-27): the pages of
// sfi-auction.html and its siblings are real catalogue pages; detail-sfi-occupied.html is a
// synthetic page that shows what those hide (the occupancy line) and what they lack.

function pageOf(result: ScrapeResult) {
  if (result.kind !== 'page') throw new Error(`expected a page, got ${result.kind}`);
  return result.page;
}

const read = (name: string) => pageOf(scrapeAuctionDetails(readCaixaFixture(name)));

describe('Details Scraper', () => {
  describe('SFI Auction', () => {
    it('extracts phase dates for 1st and 2nd auction as Brasília local time', () => {
      // "03/03/2026 - 10h00" and "09/03/2026 - 10h00" in Brasília = 13:00 UTC.
      expect(read('sfi-auction.html').phaseDates).toEqual([
        new Date('2026-03-03T13:00:00.000Z'),
        new Date('2026-03-09T13:00:00.000Z'),
      ]);
    });

    it('extracts the minimum price of each round', () => {
      const { prices } = read('sfi-auction.html');

      expect(prices.first).toEqual(new Decimal('192622.00'));
      expect(prices.second).toEqual(new Decimal('170201.84'));
      expect(prices.single).toBeNull();
    });

    it('extracts payment methods and expense rules', () => {
      const page = read('sfi-auction.html');

      expect(page.paymentMethods).toEqual([PaymentMethod.OWN_RESOURCES, PaymentMethod.FGTS]);
      expect(page.expenseRules?.length).toBeGreaterThan(0);
      expect(page.expenseRules?.[0]).toEqual({
        type: 'Condomínio',
        description: 'Sob responsabilidade do comprador.',
      });
    });

    it('extracts the property type, and leaves the occupancy unknown when Caixa hides the line', () => {
      const page = read('sfi-auction.html');

      expect(page.propertyType).toBe('Apartamento');
      // The "Situação" line is a comment in the page: not shown, so unknown (BR-004-15).
      expect(page.occupancy).toBeNull();
    });

    it('extracts the gallery, the matrícula and edital links and the edital publication date', () => {
      const page = read('sfi-auction.html');

      expect(page.photoUrls).toEqual([
        'https://venda-imoveis.caixa.gov.br/fotos/F878770800366821.jpg',
      ]);
      expect(page.matriculaUrl).toBe(
        'https://venda-imoveis.caixa.gov.br/editais/matricula/RN/8787708003668.pdf',
      );
      expect(page.editalUrl).toBe('https://venda-imoveis.caixa.gov.br/editais/EL00900225CPARE.PDF');
      // "23/01/2026 11:58:46" in Brasília = 14:58:46 UTC.
      expect(page.editalPublishedAt).toEqual(new Date('2026-01-23T14:58:46.000Z'));
    });
  });

  describe('a synthetic page with every field shown', () => {
    const page = read('detail-sfi-occupied.html');

    it('reads the occupancy line', () => {
      expect(page.occupancy).toBe('UNOCCUPIED');
      expect(page.propertyType).toBe('Casa');
    });

    it('reads every payment method, the expense rules and the description', () => {
      expect(page.paymentMethods).toEqual([
        PaymentMethod.OWN_RESOURCES,
        PaymentMethod.FGTS,
        PaymentMethod.FINANCING,
      ]);
      expect(page.expenseRules).toEqual([
        { type: 'Condomínio', description: 'Sob responsabilidade do comprador.' },
        { type: 'Tributos', description: 'Sob responsabilidade do comprador.' },
      ]);
      expect(page.description).toBe('3 Quartos, Sala, Cozinha. .');
    });

    it('reads the prices to the cent, as Decimals (AR-17)', () => {
      expect(page.prices).toEqual({
        first: new Decimal('150000.00'),
        second: new Decimal('120500.50'),
        single: null,
      });
    });

    it('reads the whole gallery in page order, once each, on Caixa’s own site only (SC-24)', () => {
      expect(page.photoUrls).toEqual([
        'https://venda-imoveis.caixa.gov.br/fotos/F1000000000011.jpg',
        'https://venda-imoveis.caixa.gov.br/fotos/F1000000000012.jpg',
        'https://venda-imoveis.caixa.gov.br/fotos/F1000000000013.jpg',
      ]);
    });
  });

  describe('Open Bidding', () => {
    it('extracts the one date and the single price', () => {
      const page = read('open-bidding.html');

      // "29/01/2026 - 10h00" in Brasília = 13:00 UTC.
      expect(page.phaseDates).toEqual([new Date('2026-01-29T13:00:00.000Z')]);
      expect(page.prices).toEqual({
        first: null,
        second: null,
        single: new Decimal('89575.84'),
      });
    });
  });

  describe('Online Sales', () => {
    it('extracts end date from strLista in carregaContador()', () => {
      // Fixture strLista contains: "30/01/2026 18:00:00", 18:00 in Brasília = 21:00 UTC.
      expect(read('online-sales.html').phaseDates).toEqual([new Date('2026-01-30T21:00:00.000Z')]);
    });
  });

  describe('Direct Online Sales', () => {
    it('has no date at all (no end date)', () => {
      expect(read('direct-online-sales.html').phaseDates).toEqual([]);
    });
  });

  describe('what is not a page', () => {
    it('says unavailable for a property no longer for sale, with no data', () => {
      expect(scrapeAuctionDetails(readCaixaFixture('unavailable-property.html'))).toEqual({
        kind: 'unavailable',
      });
    });

    it('says blocked for the bot-protection page and never parses it (BR-004-20)', () => {
      expect(scrapeAuctionDetails(readCaixaFixture('bot-protection.html'))).toEqual({
        kind: 'blocked',
      });
    });

    it('says blocked for a challenge even when real property markup is stuffed around it', () => {
      const html = `${readCaixaFixture('bot-protection.html')}${readCaixaFixture('sfi-auction.html')}`;

      expect(scrapeAuctionDetails(html).kind).toBe('blocked');
    });

    it('says unrecognised for a page it does not understand, and for an empty one', () => {
      expect(scrapeAuctionDetails(readCaixaFixture('detail-unrecognised.html'))).toEqual({
        kind: 'unrecognised',
      });
      expect(scrapeAuctionDetails('')).toEqual({ kind: 'unrecognised' });
      expect(scrapeAuctionDetails('not html at all {{{')).toEqual({ kind: 'unrecognised' });
    });
  });

  describe('missing and malformed sections stay unknown (BR-004-15, BR-004-21)', () => {
    /** A page with only a related box: whatever a spec leaves out, the page does not say. */
    const bare = (inner: string) =>
      `<html><body><div class="related-box">${inner}</div></body></html>`;

    it('has no payment methods, expense rules, type, occupancy, prices, photos or documents', () => {
      const page = pageOf(scrapeAuctionDetails(bare('<p>nothing useful</p>')));

      expect(page).toEqual({
        description: null,
        propertyType: null,
        occupancy: null,
        phaseDates: [],
        prices: { first: null, second: null, single: null },
        paymentMethods: null,
        expenseRules: null,
        photoUrls: [],
        matriculaUrl: null,
        editalUrl: null,
        editalPublishedAt: null,
      });
    });

    it('has null payment methods and rules when their sections name nothing known', () => {
      const page = pageOf(
        scrapeAuctionDetails(
          bare(
            '<p>FORMAS DE PAGAMENTO ACEITAS:<br><i class="x"></i>&nbsp;Outra forma.<br><br>REGRAS PARA PAGAMENTO DAS DESPESAS (caso existam):<br></p>',
          ),
        ),
      );

      expect(page.paymentMethods).toBeNull();
      expect(page.expenseRules).toBeNull();
    });

    it('reads a rule with no colon as a general one, and drops an empty line', () => {
      const page = pageOf(
        scrapeAuctionDetails(
          bare(
            'REGRAS PARA PAGAMENTO DAS DESPESAS:<br><i class="x"></i>&nbsp;Por conta do comprador<br><i class="x"></i>&nbsp;<br></p>',
          ),
        ),
      );

      expect(page.expenseRules).toEqual([{ type: 'Geral', description: 'Por conta do comprador' }]);
    });

    it('reads a method named twice once', () => {
      const page = pageOf(
        scrapeAuctionDetails(
          bare(
            'FORMAS DE PAGAMENTO ACEITAS:<br><i class="x"></i>&nbsp;Recursos próprios.<br><i class="x"></i>&nbsp;Recursos proprios.<br></p>',
          ),
        ),
      );

      expect(page.paymentMethods).toEqual([PaymentMethod.OWN_RESOURCES]);
    });

    it('reads a method written without accents', () => {
      const page = pageOf(
        scrapeAuctionDetails(
          bare('FORMAS DE PAGAMENTO ACEITAS:<br><i class="x"></i>&nbsp;Recursos proprios.<br></p>'),
        ),
      );

      expect(page.paymentMethods).toEqual([PaymentMethod.OWN_RESOURCES]);
    });

    it.each([
      ['Valor mínimo de venda: R$ 1,234,56', 'a thousands comma'],
      ['Valor mínimo de venda: R$ 91589.89', 'a dot decimal'],
      ['Valor mínimo de venda: R$ ', 'no amount'],
    ])('reads %s (%s) as no price', (text) => {
      const page = pageOf(scrapeAuctionDetails(bare(`<p>${text}</p>`)));

      expect(page.prices.single).toBeNull();
    });

    it.each([
      ['an occupancy of a kind it does not know', 'Ocupado por terceiros'],
      ['an empty one', ''],
    ])('reads %s as unknown', (_, value) => {
      const html = bare(`<span>Situação: <strong>${value}</strong></span>`);

      expect(pageOf(scrapeAuctionDetails(html)).occupancy).toBeNull();
    });

    it('reads Ocupado and Desocupado, with or without accents and capitals', () => {
      const occupancy = (value: string) =>
        pageOf(scrapeAuctionDetails(bare(`<span>Situação: <strong>${value}</strong></span>`)))
          .occupancy;

      expect(occupancy('Ocupado ')).toBe('OCCUPIED');
      expect(occupancy('OCUPADO')).toBe('OCCUPIED');
      expect(occupancy('Desocupado')).toBe('UNOCCUPIED');
    });

    it('refuses a date that is not a real calendar day or time', () => {
      for (const written of [
        '31/02/2026 - 10h00',
        '03/13/2026 - 10h00',
        '00/03/2026 - 10h00',
        '03/03/2026 - 25h00',
        '03/03/2026 - 10h61',
      ]) {
        const page = pageOf(
          scrapeAuctionDetails(bare(`<span>Data da Licitação Aberta - ${written}</span>`)),
        );
        expect(page.phaseDates).toEqual([]);
      }
      // The countdown's seconds are checked too.
      const countdown = (written: string) =>
        pageOf(
          scrapeAuctionDetails(
            `<html><body><div class="related-box"></div><script>strLista: "1@@" + "${written}" + "@@"</script></body></html>`,
          ),
        ).phaseDates;
      expect(countdown('30/02/2026 18:00:00')).toEqual([]);
      expect(countdown('30/01/2026 18:00:61')).toEqual([]);
      expect(countdown('30/01/2026 18:00:59')).toEqual([new Date('2026-01-30T21:00:59.000Z')]);
    });

    it('reads a 2nd-round date on its own when the 1st is missing', () => {
      const page = pageOf(
        scrapeAuctionDetails(bare('<span>Data do 2º Leilão - 09/03/2026 - 10h00</span>')),
      );

      expect(page.phaseDates).toEqual([new Date('2026-03-09T13:00:00.000Z')]);
    });

    it('falls back to the preview image when there is no gallery, and drops one off the site', () => {
      const withPreview = pageOf(
        scrapeAuctionDetails(bare('<img id="preview" src="/fotos/F1.jpg">')),
      );
      const offSite = pageOf(
        scrapeAuctionDetails(bare('<img id="preview" src="https://cdn.example.test/F1.jpg">')),
      );
      const odd = pageOf(
        scrapeAuctionDetails(
          bare(
            '<div class="thumbnails"><img src="data:image/png;base64,AAAA"><img src="//x.test/a.jpg"><img></div>',
          ),
        ),
      );

      expect(withPreview.photoUrls).toEqual(['https://venda-imoveis.caixa.gov.br/fotos/F1.jpg']);
      expect(offSite.photoUrls).toEqual([]);
      expect(odd.photoUrls).toEqual([]);
    });

    it('keeps a bounded gallery however many images a hostile page holds', () => {
      const images = Array.from({ length: 500 }, (_, i) => `<img src="/fotos/F${i}.jpg">`).join('');
      const page = pageOf(scrapeAuctionDetails(bare(`<div class="thumbnails">${images}</div>`)));

      expect(page.photoUrls).toHaveLength(100);
    });

    it('keeps the document paths as absolute links on Caixa’s own site', () => {
      const page = pageOf(
        scrapeAuctionDetails(
          bare('<a onclick="ExibeDoc(\'/editais/EL1.PDF\')">e</a>') +
            '<script>ExibeDoc("/editais/matricula/XX/1.pdf")</script>',
        ),
      );

      expect(page.editalUrl).toBe('https://venda-imoveis.caixa.gov.br/editais/EL1.PDF');
      expect(page.matriculaUrl).toBe(
        'https://venda-imoveis.caixa.gov.br/editais/matricula/XX/1.pdf',
      );
    });

    it('has no publication date when the line is malformed', () => {
      const page = pageOf(
        scrapeAuctionDetails(bare('<span>(Edital publicado em: ontem às 10h)</span>')),
      );

      expect(page.editalPublishedAt).toBeNull();
    });
  });

  // SC-19 / CodeQL js/incomplete-multi-character-sanitization: the description is plain text, so
  // nothing a crafted page nests inside a tag may survive as markup.
  describe('description markup stripping', () => {
    const pageWithDescription = (description: string) =>
      `<html><body><div class="related-box"><p><strong>Descrição:</strong><br>${description}</p></div></body></html>`;
    const descriptionOf = (description: string) =>
      pageOf(scrapeAuctionDetails(pageWithDescription(description))).description;

    it('keeps the text and drops the tags of an ordinary description', () => {
      expect(descriptionOf('2 Quartos,&nbsp;<b>Sala</b><br>Cozinha  ')).toBe(
        '2 Quartos, SalaCozinha',
      );
    });

    // What is left is what a browser would show as text, so no tag name can be rebuilt from it.
    it.each([
      '<scr<script>ipt>alert(1)</scr</script>ipt>',
      '<<b>script>alert(1)<</b>/script>',
      '<img src=x onerror=alert(1)//<b>>',
      '<scr<scr<script>ipt>ipt>alert(1)',
    ])('leaves no tag behind for the nested input %s', (input) => {
      expect(descriptionOf(input) ?? '').not.toMatch(/[<>]/);
    });

    it('keeps text that only looks like a tag after parsing inert', () => {
      expect(descriptionOf('<<b>script>alert(1)<</b>/script>')).toBe(
        '&lt;script&gt;alert(1)&lt;/script&gt;',
      );
    });

    it('keeps an ampersand entity-encoded as before', () => {
      expect(descriptionOf('Sala &amp; Cozinha')).toBe('Sala &amp; Cozinha');
    });

    it('drops the markup a nested tag would have left behind', () => {
      expect(descriptionOf('<scr<script>ipt>alert(1)</scr</script>ipt>')).toBe(
        'ipt&gt;alert(1)ipt&gt;',
      );
    });

    it('has no description when the page has no such paragraph', () => {
      expect(
        pageOf(
          scrapeAuctionDetails('<html><body><div class="related-box"><p>x</p></div></body></html>'),
        ).description,
      ).toBeNull();
    });
  });

  // SC-24, SC-19: Caixa's HTML is untrusted. A hostile or broken page must cost little and must not
  // fill the database.
  describe('a hostile page', () => {
    const MiB = 1024 * 1024;
    const bare = (inner: string) =>
      `<html><body><div class="related-box">${inner}</div></body></html>`;

    it('is refused before it is parsed when it is over the page cap', () => {
      const started = performance.now();

      const result = scrapeAuctionDetails(bare('x'.repeat(2 * MiB + 1)));

      expect(result).toEqual({ kind: 'unrecognised' });
      expect(performance.now() - started).toBeLessThan(200);
    });

    // Timing on a loaded machine is noisy, so the proof is the SHAPE: four times the page costs
    // about four times the time (a pattern that restarts at every position costs sixteen).
    const fastest = (html: string) => {
      const runs = Array.from({ length: 3 }, () => {
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
    ])('is read in linear time for 1 MiB of %s', (_, unit) => {
      const page = (bytes: number) => bare(unit.repeat(Math.ceil(bytes / unit.length)));
      const small = fastest(page(MiB / 4));
      const large = fastest(page(MiB));

      expect(large).toBeLessThan(small * 8 + 100); // linear is ~4x; quadratic would be ~16x
      expect(large).toBeLessThan(3000); // and never anywhere near a stall
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
});
