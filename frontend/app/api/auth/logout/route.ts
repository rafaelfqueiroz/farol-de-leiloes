import { NextRequest, NextResponse } from 'next/server';
import { backendFetch, refuseForeignOrigin } from '@/lib/backend';
import { reportClientError } from '@/lib/report-client-error';
import { clearSessionCookie, sessionTokenOf } from '@/lib/session-cookie';

// BR-001-18, SC-02: signing out ends the session on the server (best effort) and always clears the
// browser's cookie, signed in or not, so the browser is signed out even when the backend is down.
export async function POST(request: NextRequest) {
  const refused = refuseForeignOrigin(request);
  if (refused) return refused;

  const token = sessionTokenOf(request);
  if (token) {
    try {
      await backendFetch('/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error: unknown) {
      reportClientError(error, { where: 'api/auth/logout POST' });
    }
  }

  const response = new NextResponse(null, { status: 204 });
  clearSessionCookie(response);
  return response;
}
