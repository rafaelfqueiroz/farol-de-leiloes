import { NextRequest } from 'next/server';
import { pickQuery, proxyToBackend } from '@/lib/backend';

// SPEC-012 BR-012-11: the office plan, for any current member. `officeId` only chooses among the
// caller's own offices; the backend resolves and checks the office (AR-13).
export async function GET(request: NextRequest) {
  return proxyToBackend(request, '/office/subscription', {
    auth: true,
    query: pickQuery(request, ['officeId']),
  });
}
