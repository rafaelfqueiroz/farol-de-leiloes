import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import AuctionDetailClient, { Auction } from './AuctionDetailClient';
import { reportClientError } from '@/lib/report-client-error';

// ISR: Revalidate every hour
export const revalidate = 3600;

const BACKEND_URL = process.env.NEXT_PUBLIC_AUCTIONS_API_URL || 'http://localhost:3000';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://faroldosleiloes.com.br';

async function fetchAuction(code: string): Promise<Auction | null> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/auctions/${code}`, {
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      return null;
    }

    return response.json();
  } catch (error) {
    reportClientError(error, { where: 'auction/[code] page' });
    return null;
  }
}

function formatAddress(address: Auction['address']): string {
  const parts = [address.neighborhood, address.city, address.state].filter(Boolean);
  return parts.join(', ') || 'Localização não informada';
}

function formatCurrency(value?: number): string {
  if (!value) return '';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

type PageProps = {
  params: Promise<{ code: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const auction = await fetchAuction(code);

  if (!auction) {
    return {
      title: 'Leilão não encontrado | Farol dos Leilões',
      description: 'O leilão solicitado não foi encontrado.',
    };
  }

  const lastPhase = auction.phases[auction.phases.length - 1];
  const locationText = formatAddress(auction.address);
  const priceText = lastPhase?.minimumPrice
    ? `Lance mínimo: ${formatCurrency(lastPhase.minimumPrice)}`
    : '';

  const title = auction.title || `Imóvel em ${locationText}`;
  const description = [
    `Imóvel em leilão em ${locationText}.`,
    priceText,
    auction.description?.slice(0, 100),
  ]
    .filter(Boolean)
    .join(' ');

  return {
    title: `${title} | Farol dos Leilões`,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      url: `${SITE_URL}/auction/${code}`,
      images: auction.imageUrl
        ? [
            {
              url: auction.imageUrl,
              width: 1200,
              height: 630,
              alt: title,
            },
          ]
        : undefined,
      locale: 'pt_BR',
      siteName: 'Farol dos Leilões',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: auction.imageUrl ? [auction.imageUrl] : undefined,
    },
    alternates: {
      canonical: `${SITE_URL}/auction/${code}`,
    },
  };
}

function generateJsonLd(auction: Auction) {
  const lastPhase = auction.phases[auction.phases.length - 1];

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: auction.title || 'Imóvel em Leilão',
    description: auction.description || `Imóvel em leilão em ${formatAddress(auction.address)}`,
    image: auction.imageUrl,
    offers: {
      '@type': 'Offer',
      price: lastPhase?.minimumPrice || undefined,
      priceCurrency: 'BRL',
      availability: auction.available ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
      url: `${SITE_URL}/auction/${auction.code}`,
    },
    ...(auction.address && {
      address: {
        '@type': 'PostalAddress',
        streetAddress: auction.address.street,
        addressLocality: auction.address.city,
        addressRegion: auction.address.state,
        postalCode: auction.address.zipcode,
        addressCountry: 'BR',
      },
    }),
  };
}

export default async function AuctionDetailPage({ params }: PageProps) {
  const { code } = await params;
  const auction = await fetchAuction(code);

  if (!auction) {
    notFound();
  }

  const jsonLd = generateJsonLd(auction);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <AuctionDetailClient auction={auction} />
    </>
  );
}
