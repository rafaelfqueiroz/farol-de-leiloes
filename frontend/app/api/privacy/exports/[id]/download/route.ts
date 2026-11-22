import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend } from '@/lib/backend';
import { isObjectId } from '@/lib/object-id';

// SPEC-010 BR-010-11: a 60-second link to the export file, for its owner only. The answer is the
// JSON `{ url, expiresInSeconds }`; the BROWSER navigates to the link, this route never fetches the
// file and never logs the link (SC-18).
//
// The id goes into the backend path, so only the shape of a real one gets that far: 24 hex
// characters. Anything else is the same NOT_FOUND the backend gives an export that does not exist
// or belongs to another account, answered here without calling it.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isObjectId(id)) {
    return NextResponse.json({ code: 'NOT_FOUND', context: {} }, { status: 404 });
  }
  return proxyToBackend(request, `/privacy/exports/${id}/download`, {
    auth: true,
    label: 'api/privacy/exports/:id/download',
  });
}
