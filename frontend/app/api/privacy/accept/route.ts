import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/backend';

// SPEC-010 BR-010-05: accepting the current versions again. The body (the two versions the person
// read) goes to the backend as sent; the backend refuses a version that is not the current one.
export async function POST(request: NextRequest) {
  return proxyToBackend(request, '/privacy/accept', { auth: true });
}
