import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/backend';

// BR-001-09: a first Google sign-in creates the account once the terms are accepted; like the
// exchange, the backend's answer carries the session, which the BFF moves into the cookie.
export async function POST(request: NextRequest) {
  return proxyToBackend(request, '/auth/google/complete', { startsSession: true });
}
