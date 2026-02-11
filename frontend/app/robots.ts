import { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://faroldosleiloes.com.br';

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
