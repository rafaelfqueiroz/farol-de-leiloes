import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/backend';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyToBackend(request, `/saved-filters/${encodeURIComponent(id)}`, { auth: true });
}
