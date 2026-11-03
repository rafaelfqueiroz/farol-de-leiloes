import { NextRequest } from 'next/server';
import { pageQuery, proxyToBackend } from '@/lib/backend';

export async function GET(request: NextRequest) {
  // AR-35: the list is paginated
  return proxyToBackend(request, '/saved-filters', { auth: true, query: pageQuery(request) });
}

export async function POST(request: NextRequest) {
  return proxyToBackend(request, '/saved-filters', { auth: true });
}
