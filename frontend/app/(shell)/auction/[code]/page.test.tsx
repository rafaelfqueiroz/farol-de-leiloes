// @vitest-environment node
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { createTranslator } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuctionDetail } from '@/lib/auction';
import messages from '@/messages/pt-BR.json';
import AuctionDetailPage, { generateMetadata } from './page';

// SPEC-005: the public property page is rendered on the server from GET /api/auctions/:code. It
// answers 404 for a code the API does not know, and carries the metadata search engines read.
const env = vi.hoisted(() => ({ notFound: vi.fn() }));
const fetchMock = vi.fn();

vi.mock('next/navigation', () => ({ notFound: env.notFound }));
// the interactive part has its own spec; here only the props the server hands it matter
vi.mock('./AuctionDetailClient', () => ({ default: () => null }));
// the translator of the real pt-BR catalogue, as the server API would hand it out
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
}));
vi.mock('@/lib/report-client-error', () => ({ reportClientError: vi.fn() }));

const SITE = 'https://faroldosleiloes.com.br';

function anAuction(overrides: Partial<AuctionDetail> = {}): AuctionDetail {
  return {
    code: '1444400000001',
    title: 'Casa em condomínio',
    address: { neighborhood: 'Ponta Negra', city: 'Natal', state: 'RN', street: 'Rua Teste, 10' },
    appraisalPrice: '500000.00',
    phases: [
      { modality: 'Venda Online', minimumPrice: '400000.00' },
      { modality: 'Venda Direta', minimumPrice: '350000.00' },
    ],
    available: true,
    description: 'Imóvel residencial.',
    ...overrides,
  };
}

function backendAnswers(status: number, body: unknown) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  vi.stubEnv('BACKEND_API_URL', 'http://backend:3000');
  vi.stubGlobal('fetch', fetchMock);
  env.notFound.mockReset();
  env.notFound.mockImplementation(() => {
    throw new Error('NEXT_NOT_FOUND');
  });
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const params = (code: string) => ({ params: Promise.resolve({ code }) });

describe('generateMetadata', () => {
  it('asks the API for the auction, by its encoded code', async () => {
    backendAnswers(200, anAuction());

    await generateMetadata(params('a/b'));

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://backend:3000/api/auctions/a%2Fb');
  });

  it('titles the page with the property and the site, and describes the minimum bid', async () => {
    backendAnswers(200, anAuction());

    const metadata = await generateMetadata(params('1444400000001'));

    expect(metadata.title).toBe('Casa em condomínio | Farol dos Leilões');
    // the last phase's minimum price (R$ 350.000,00), the place and the first 100 characters
    expect(metadata.description).toMatch(
      /^Imóvel em leilão em Ponta Negra, Natal, RN\. Lance mínimo: R\$\s350\.000,00 Imóvel residencial\.$/,
    );
  });

  it('points the canonical URL and the social cards at the public page', async () => {
    backendAnswers(200, anAuction({ imageUrl: 'https://img.example.test/a.jpg' }));

    const metadata = await generateMetadata(params('1444400000001'));

    expect(metadata.alternates?.canonical).toBe(`${SITE}/auction/1444400000001`);
    expect(metadata.openGraph).toMatchObject({
      url: `${SITE}/auction/1444400000001`,
      locale: 'pt_BR',
      images: [{ url: 'https://img.example.test/a.jpg', width: 1200, height: 630 }],
    });
    expect(metadata.twitter).toMatchObject({
      card: 'summary_large_image',
      images: ['https://img.example.test/a.jpg'],
    });
  });

  it('sends no images when the property has none', async () => {
    backendAnswers(200, anAuction());

    const metadata = await generateMetadata(params('1444400000001'));

    expect(metadata.openGraph).toMatchObject({ images: undefined });
    expect(metadata.twitter).toMatchObject({ images: undefined });
  });

  it('names the property by its place when Caixa gave it no title', async () => {
    backendAnswers(
      200,
      anAuction({ title: '', address: { city: 'Natal', state: 'RN' }, description: undefined }),
    );

    const metadata = await generateMetadata(params('1444400000001'));

    expect(metadata.title).toBe('Imóvel em Natal, RN | Farol dos Leilões');
  });

  it('leaves the minimum bid out when the last phase has none', async () => {
    backendAnswers(
      200,
      anAuction({ phases: [{ modality: 'Venda Online', minimumPrice: null }], description: '' }),
    );

    const metadata = await generateMetadata(params('1444400000001'));

    expect(metadata.description).toBe('Imóvel em leilão em Ponta Negra, Natal, RN.');
  });

  it('falls back to a generic place when the address is empty', async () => {
    backendAnswers(200, anAuction({ title: '', address: {}, phases: [], description: '' }));

    const metadata = await generateMetadata(params('1444400000001'));

    expect(metadata.title).toBe('Imóvel em Localização não informada | Farol dos Leilões');
  });

  it('says the auction was not found when the API answers 404', async () => {
    backendAnswers(404, { code: 'AUCTION_NOT_FOUND', context: {} });

    const metadata = await generateMetadata(params('0'));

    expect(metadata.title).toBe('Leilão não encontrado | Farol dos Leilões');
    expect(metadata.description).toBe('O leilão solicitado não foi encontrado.');
    expect(metadata.openGraph).toBeUndefined();
  });

  it('treats an unreachable API as not found instead of failing the render', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const metadata = await generateMetadata(params('1'));

    expect(metadata.title).toBe('Leilão não encontrado | Farol dos Leilões');
  });
});

function elementsOf(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  const children = node.props.children as ReactNode;
  return [node, ...(Array.isArray(children) ? children : [children]).flatMap(elementsOf)];
}

describe('AuctionDetailPage', () => {
  it('shows the not-found page when the API does not know the code', async () => {
    backendAnswers(404, { code: 'AUCTION_NOT_FOUND', context: {} });

    await expect(AuctionDetailPage(params('0'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(env.notFound).toHaveBeenCalledTimes(1);
  });

  it('hands the auction to the client page and describes it as schema.org JSON-LD', async () => {
    backendAnswers(200, anAuction());

    const page = await AuctionDetailPage(params('1444400000001'));

    const elements = elementsOf(page);
    const client = elements.find((element) => 'auction' in element.props);
    expect(client?.props.auction).toMatchObject({ code: '1444400000001' });
    const script = elements.find((element) => element.type === 'script');
    const html = (script?.props.dangerouslySetInnerHTML as { __html: string }).__html;
    expect(JSON.parse(html)).toMatchObject({
      '@type': 'Product',
      name: 'Casa em condomínio',
      description: 'Imóvel residencial.',
      offers: {
        // the price stays the decimal string of the API (AR-17)
        price: '350000.00',
        priceCurrency: 'BRL',
        availability: 'https://schema.org/InStock',
        url: `${SITE}/auction/1444400000001`,
      },
      address: { streetAddress: 'Rua Teste, 10', addressLocality: 'Natal', addressRegion: 'RN' },
    });
  });

  it('marks an unavailable property as sold out and names it when it has no title', async () => {
    backendAnswers(200, anAuction({ title: '', available: false, description: undefined }));

    const page = await AuctionDetailPage(params('1444400000001'));

    const script = elementsOf(page).find((element) => element.type === 'script');
    const jsonLd = JSON.parse((script?.props.dangerouslySetInnerHTML as { __html: string }).__html);
    expect(jsonLd.name).toBe('Imóvel em leilão');
    expect(jsonLd.description).toBe('Imóvel em leilão em Ponta Negra, Natal, RN.');
    expect(jsonLd.offers.availability).toBe('https://schema.org/SoldOut');
  });

  it('escapes "<" in auction text so it cannot close the script element (SC-17)', async () => {
    backendAnswers(200, anAuction({ description: '</script><script>alert(1)</script>' }));

    const page = await AuctionDetailPage(params('1444400000001'));

    const script = elementsOf(page).find((element) => element.type === 'script');
    const html = (script?.props.dangerouslySetInnerHTML as { __html: string }).__html;
    expect(html).not.toContain('</script>');
    expect(html).toContain('\\u003c/script>');
  });
});
