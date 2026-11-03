import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/backend';

export async function GET(request: NextRequest) {
  return proxyToBackend(request, '/auth/verification-status', { auth: true });
}
