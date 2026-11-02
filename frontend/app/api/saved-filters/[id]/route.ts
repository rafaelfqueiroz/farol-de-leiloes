import { NextRequest, NextResponse } from 'next/server';
import { errorMessage } from '@/lib/error-message';
import { reportClientError } from '@/lib/report-client-error';

const BACKEND_URL = process.env.NEXT_PUBLIC_AUCTIONS_API_URL || 'http://localhost:3000';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authHeader = request.headers.get('Authorization');

    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const url = `${BACKEND_URL}/api/saved-filters/${id}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: authHeader,
      },
    });

    if (!response.ok && response.status !== 204) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      return NextResponse.json(
        { error: errorData.message || `Backend error: ${response.statusText}` },
        { status: response.status },
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (error: unknown) {
    reportClientError(error, { where: 'api/saved-filters/[id] DELETE' });
    return NextResponse.json(
      { error: errorMessage(error) || 'Failed to delete saved filter' },
      { status: 500 },
    );
  }
}
