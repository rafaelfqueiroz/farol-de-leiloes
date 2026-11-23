import { NextRequest } from 'next/server';
import { pageQuery, proxyToBackend } from '@/lib/backend';

// SPEC-010 BR-010-09, BR-010-11: ask for an export of the account's data, and read the account's
// own exports, newest first (paginated, AR-35).
export async function GET(request: NextRequest) {
  return proxyToBackend(request, '/privacy/exports', { auth: true, query: pageQuery(request) });
}

export async function POST(request: NextRequest) {
  return proxyToBackend(request, '/privacy/exports', { auth: true });
}
