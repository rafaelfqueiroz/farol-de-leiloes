import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/backend';

export async function GET(request: NextRequest) {
  return proxyToBackend(request, '/payments/subscription-status', { auth: true });
}
