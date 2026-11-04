import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/backend';

const FORWARDED_PARAMS = [
  'state',
  'city',
  'neighborhood',
  'modality',
  'minPrice',
  'maxPrice',
  'page',
  'pageSize',
] as const;

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  // Only the known filters reach the backend; everything else on the URL is dropped here.
  const params = new URLSearchParams();
  for (const name of FORWARDED_PARAMS) {
    const value = searchParams.get(name);
    if (value) params.set(name, value);
  }

  return proxyToBackend(request, '/auctions', { query: params.toString() });
}
