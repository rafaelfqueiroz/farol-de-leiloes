import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/backend';

export async function PATCH(request: NextRequest) {
  return proxyToBackend(request, '/auth/profile', { auth: true });
}
