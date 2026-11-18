import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/backend';

// SPEC-012 BR-012-09: the success page asks whether the provider confirmed the payment. The ref is
// the buyer's own checkout; the backend answers another account's ref as a missing one (AR-14).
export async function GET(request: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return proxyToBackend(request, `/subscriptions/checkout/${encodeURIComponent(ref)}/status`, {
    auth: true,
  });
}
