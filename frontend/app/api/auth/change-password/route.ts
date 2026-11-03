import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/backend';

export async function POST(request: NextRequest) {
  return proxyToBackend(request, '/auth/change-password', { auth: true });
}
