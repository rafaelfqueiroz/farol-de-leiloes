import { MetadataRoute } from 'next';
import { reportClientError } from '@/lib/report-client-error';

const BACKEND_URL = process.env.NEXT_PUBLIC_AUCTIONS_API_URL || 'http://localhost:3000';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://faroldosleiloes.com.br';

interface AuctionCode {
  code: string;
  updatedAt: string;
}

async function fetchAuctionCodes(): Promise<AuctionCode[]> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/auctions/sitemap/codes`, {
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      reportClientError(new Error(`Backend returned ${response.status}`), { where: 'sitemap' });
      return [];
    }

    const data = await response.json();
    return data.codes || [];
  } catch (error) {
    reportClientError(error, { where: 'sitemap' });
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const auctionCodes = await fetchAuctionCodes();

  const auctionUrls: MetadataRoute.Sitemap = auctionCodes.map((auction) => ({
    url: `${SITE_URL}/auction/${auction.code}`,
    lastModified: new Date(auction.updatedAt),
    changeFrequency: 'daily',
    priority: 0.8,
  }));

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/plans`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
  ];

  return [...staticPages, ...auctionUrls];
}
