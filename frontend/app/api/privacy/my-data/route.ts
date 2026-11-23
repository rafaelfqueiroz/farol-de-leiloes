import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/backend';

// SPEC-010 BR-010-08: the personal data held for the signed-in account. SC-15: the body is never
// read, logged or reported here; it goes to the browser as the backend sent it.
export async function GET(request: NextRequest) {
  return proxyToBackend(request, '/privacy/my-data', { auth: true });
}
