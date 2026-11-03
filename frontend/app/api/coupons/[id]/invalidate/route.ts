import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/backend';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyToBackend(request, `/coupons/${encodeURIComponent(id)}/invalidate`, { auth: true });
}
