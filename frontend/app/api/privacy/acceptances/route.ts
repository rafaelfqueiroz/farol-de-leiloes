import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/backend';

// SPEC-010 BR-010-04: the versions the signed-in account accepted, with when and how.
export async function GET(request: NextRequest) {
  return proxyToBackend(request, '/privacy/acceptances', { auth: true });
}
