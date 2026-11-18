import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/backend';

// SPEC-012 BR-012-05: the offered plans are public; no session is needed or forwarded.
export async function GET(request: NextRequest) {
  return proxyToBackend(request, '/plans');
}
