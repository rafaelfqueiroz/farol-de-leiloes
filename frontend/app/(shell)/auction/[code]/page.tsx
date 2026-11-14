import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import AuctionDetailClient from './AuctionDetailClient';
import { backendFetch } from '@/lib/backend';
import { publicEnv } from '@/lib/env';
import type { AuctionDetail } from '@/lib/auction';
import { formatMoney } from '@/lib/money';
import { reportClientError } from '@/lib/report-client-error';

const SITE_URL = publicEnv.siteUrl;

async function fetchAuction(code: string): Promise<AuctionDetail | null> {
  try {
    const response = await backendFetch(`/auctions/${encodeURIComponent(code)}`, {
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

function formatLocation(address: AuctionDetail['address'], fallback: string): string {
  const parts = [address.neighborhood, address.city, address.state].filter(Boolean);
  return parts.join(', ') || fallback;
}

type MetadataTranslator = Awaited<ReturnType<typeof getTranslations<'auctionDetail.metadata'>>>;

type PageProps = {
  params: Promise<{ code: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const auction = await fetchAuction(code);
  const t = await getTranslations('auctionDetail.metadata');
  const siteName = (await getTranslations('patterns.logo'))('name');

  if (!auction) {
    return {
      title: t('siteTitle', { title: t('notFound'), siteName }),
      description: t('notFoundDescription'),
    };
  }

  const lastPhase = auction.phases[auction.phases.length - 1];
  const locationText = formatLocation(auction.address, t('location'));
  const priceText = lastPhase?.minimumPrice
    ? t('minimumBid', { price: formatMoney(lastPhase.minimumPrice) })
    : '';

  const title = auction.title || t('fallbackTitle', { location: locationText });
  const description = [
    t('summary', { location: locationText }),
    priceText,
    auction.description?.slice(0, 100),
  ]
    .filter(Boolean)
    .join(' ');

  return {
    title: t('siteTitle', { title, siteName }),
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
      siteName,
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

function generateJsonLd(auction: AuctionDetail, t: MetadataTranslator) {
  const lastPhase = auction.phases[auction.phases.length - 1];

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: auction.title || t('fallbackName'),
    description:
      auction.description ||
      t('summary', { location: formatLocation(auction.address, t('location')) }),
    image: auction.imageUrl,
    offers: {
      '@type': 'Offer',
      // schema.org takes the price as a decimal string, which is what the API sends (AR-17)
      price: lastPhase?.minimumPrice ?? undefined,
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

  const jsonLd = generateJsonLd(auction, await getTranslations('auctionDetail.metadata'));

  return (
    <>
      <script
        type="application/ld+json"
        // SC-17: auction text must never terminate the JSON script element.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <AuctionDetailClient auction={auction} />
    </>
  );
}
