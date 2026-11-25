// SPEC-004 BR-004-05, SC-24, SC-19: the parser's rows as the rows the apply takes.
import { describe, expect, it } from 'vitest';
import { PhaseModality } from '../domain/modality.js';
import { toListRows } from './list-rows.js';
import type { NormalizedAuctionRow } from './parser.js';

const row = (overrides: Partial<NormalizedAuctionRow>): NormalizedAuctionRow => ({
  code: '1',
  modality: 'Venda Online',
  propertyType: null,
  moneyUnreadable: false,
  ...overrides,
});

describe('toListRows', () => {
  it('leaves out a row with no number, keeps one with an unknown modality, and counts both', () => {
    const result = toListRows([
      row({ code: undefined }),
      row({ code: '2', modality: 'Concorrência' }),
      row({ code: '3' }),
    ]);

    expect(result.rows.map((r) => [r.code, r.modality])).toEqual([
      ['2', null],
      ['3', PhaseModality.ONLINE_SALES],
    ]);
    expect(result).toMatchObject({ withoutCode: 1, unknownModality: 1, offSiteLinks: 0 });
  });

  it("keeps a link on Caixa's own site, and absolutises a relative one", () => {
    const { rows } = toListRows([
      row({
        detailsUrl: 'https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=1',
      }),
      row({ code: '2', detailsUrl: '/sistema/detalhe-imovel.asp?hdnimovel=2' }),
    ]);

    expect(rows.map((r) => r.detailsUrl)).toEqual([
      'https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=1',
      'https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=2',
    ]);
  });

  it.each([
    'https://evil.example/detalhe',
    'https://venda-imoveis.caixa.gov.br.evil.example/x',
    'https://user:pw@venda-imoveis.caixa.gov.br/x',
    'http://venda-imoveis.caixa.gov.br/x',
  ])("drops a link that is not on Caixa's site (%s) and counts it", (detailsUrl) => {
    const result = toListRows([row({ detailsUrl })]);

    expect(result.rows[0]?.detailsUrl).toBeNull();
    expect(result.offSiteLinks).toBe(1);
  });

  it('has no link for a row with none, and does not count that as off-site', () => {
    const result = toListRows([row({})]);

    expect(result.rows[0]?.detailsUrl).toBeNull();
    expect(result.offSiteLinks).toBe(0);
  });
});
