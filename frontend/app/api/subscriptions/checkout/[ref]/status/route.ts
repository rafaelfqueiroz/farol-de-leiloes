import { NextRequest, NextResponse } from 'next/server';
import { isCheckoutRef } from '@/app/components/plans/plans-api';
import { proxyToBackend } from '@/lib/backend';

// SPEC-012 BR-012-09: the success page asks whether the provider confirmed the payment. The ref is
// the buyer's own checkout; the backend answers another account's ref as a missing one (AR-14).
//
// The ref goes into the backend path, so only the shape of a real one gets that far: 24 hex
// characters. Anything else (`..`, `%2e%2e`, a slash, an empty or very long value) is the same
// NOT_FOUND the backend gives a ref that does not exist, answered here without calling it.
export async function GET(request: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  if (!isCheckoutRef(ref)) {
    return NextResponse.json({ code: 'NOT_FOUND', context: {} }, { status: 404 });
  }
  return proxyToBackend(request, `/subscriptions/checkout/${ref}/status`, {
    auth: true,
    label: 'api/subscriptions/checkout/:ref/status',
  });
}
