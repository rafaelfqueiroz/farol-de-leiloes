import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/backend';

// SPEC-010 BR-010-02, BR-010-05: the terms and the privacy policy in force, public (the sign-up
// form and the re-acceptance dialog read the versions they show from here). No cookie is read or
// forwarded: the texts carry no account data.
export async function GET(request: NextRequest) {
  return proxyToBackend(request, '/legal/current');
}
