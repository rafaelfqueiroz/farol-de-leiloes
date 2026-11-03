import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/backend';

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return proxyToBackend(request, `/auctions/${encodeURIComponent(code)}`);
}
