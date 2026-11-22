import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/backend';
import { clearSessionCookie } from '@/lib/session-cookie';

// SPEC-010 BR-010-13, BR-010-14: closing the account needs the identity proved again (the password,
// or the one-time code of a Google re-authentication) and `confirm: true`; the BFF forwards the body
// as sent and never reads it (SC-15). Once the backend says the account is closed its sessions are
// all dead, so the browser's cookie is cleared with that answer, and only with that answer: a refusal
// (wrong password, too many attempts, a stale Google code) leaves the session as it was, exactly
// like a 401 never clears it (BR-001-18).
export async function POST(request: NextRequest) {
  const response = await proxyToBackend(request, '/privacy/delete-account', {
    auth: true,
    label: 'api/privacy/delete-account',
  });
  if (response.ok) clearSessionCookie(response);
  return response;
}
