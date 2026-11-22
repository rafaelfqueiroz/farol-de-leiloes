import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/backend';

// SPEC-010 BR-010-27: the WhatsApp consent of the signed-in account, read and answered.
export async function GET(request: NextRequest) {
  return proxyToBackend(request, '/privacy/whatsapp-consent', { auth: true });
}

export async function POST(request: NextRequest) {
  return proxyToBackend(request, '/privacy/whatsapp-consent', { auth: true });
}
