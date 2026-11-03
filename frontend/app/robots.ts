import { MetadataRoute } from 'next';
import { publicEnv } from '@/lib/env';

const SITE_URL = publicEnv.siteUrl;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/profile/', '/reminders/', '/api/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
