import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/backend';

export async function POST(request: NextRequest) {
  return proxyToBackend(request, '/payments/create-checkout-session', { auth: true });
}
