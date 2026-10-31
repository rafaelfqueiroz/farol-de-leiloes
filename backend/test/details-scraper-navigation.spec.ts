import puppeteer from 'puppeteer-extra';
import { fetchAndCheckAvailability } from '../src/auctions/scraper/details-scraper';

jest.mock('puppeteer-extra', () => ({
  __esModule: true,
  default: { use: jest.fn(), launch: jest.fn() },
}));

const URL = 'https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=1';

function mockBrowser(response: { ok: () => boolean; status: () => number } | null, html = '<html></html>') {
  const close = jest.fn();
  const page = {
    goto: jest.fn().mockResolvedValue(response),
    content: jest.fn().mockResolvedValue(html),
  };
  (puppeteer.launch as jest.Mock).mockResolvedValue({
    newPage: jest.fn().mockResolvedValue(page),
    close,
  });
  return { close };
}

describe('fetchAuctionDetailHtml navigation checks', () => {
  afterEach(() => jest.clearAllMocks());

  it('throws on an unsuccessful HTTP status and closes the browser', async () => {
    const { close } = mockBrowser({ ok: () => false, status: () => 503 });

    await expect(fetchAndCheckAvailability(URL)).rejects.toThrow('HTTP error! status: 503');
    expect(close).toHaveBeenCalled();
  });

  it('throws when navigation returns no response', async () => {
    mockBrowser(null);

    await expect(fetchAndCheckAvailability(URL)).rejects.toThrow('No response received from navigation');
  });

  it('returns true for an available auction on a 200 response', async () => {
    mockBrowser({ ok: () => true, status: () => 200 });

    await expect(fetchAndCheckAvailability(URL)).resolves.toBe(true);
  });
});
