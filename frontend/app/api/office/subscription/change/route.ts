import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/backend';

// SPEC-012: forwarded as sent; the backend validates the body and the office (AR-13, AR-34).
export async function POST(request: NextRequest) {
  return proxyToBackend(request, '/office/subscription/change', { auth: true });
}
