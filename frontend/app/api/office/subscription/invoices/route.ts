import { NextRequest } from 'next/server';
import { pickQuery, proxyToBackend } from '@/lib/backend';

export async function GET(request: NextRequest) {
  // AR-35: the billing history is paginated (six a page by default, decided by the backend)
  return proxyToBackend(request, '/office/subscription/invoices', {
    auth: true,
    query: pickQuery(request, ['officeId', 'page', 'pageSize']),
  });
}
