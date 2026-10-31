import { fetchAndCheckAvailability } from '../src/auctions/scraper/details-scraper';

describe('fetchAndCheckAvailability (integration)', () => {
  it('returns false for an unavailable auction', async () => {
    const result = await fetchAndCheckAvailability(
      'https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=8787701897035',
    );

    expect(result).toBe(false);
  }, 30000);
});
