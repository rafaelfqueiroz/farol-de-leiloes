import { NextRequest, NextResponse } from 'next/server';
import { errorMessage } from '@/lib/error-message';
import { reportClientError } from '@/lib/report-client-error';

const BACKEND_URL = process.env.NEXT_PUBLIC_AUCTIONS_API_URL || 'http://localhost:3000';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const authHeader = request.headers.get('Authorization');

    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { code } = await params;
    const url = `${BACKEND_URL}/api/favorites/${code}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: authHeader,
      },
    });

    if (!response.ok && response.status !== 204) {
      throw new Error(`Backend returned ${response.status}: ${response.statusText}`);
    }

    return new NextResponse(null, { status: 204 });
  } catch (error: unknown) {
    reportClientError(error, { where: 'api/favorites/[code] DELETE' });
    return NextResponse.json(
      { error: errorMessage(error) || 'Failed to delete favorite' },
      { status: 500 },
    );
  }
}
