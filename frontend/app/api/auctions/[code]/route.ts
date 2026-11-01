import { NextRequest, NextResponse } from 'next/server';
import { errorMessage } from '@/lib/error-message';
import { reportClientError } from '@/lib/report-client-error';

const BACKEND_URL = process.env.NEXT_PUBLIC_AUCTIONS_API_URL || 'http://localhost:3000';

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const url = `${BACKEND_URL}/api/auctions/${code}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    return NextResponse.json(data);
  } catch (error: unknown) {
    reportClientError(error, { where: 'api/auctions/[code] GET' });
    return NextResponse.json(
      { error: errorMessage(error) || 'Failed to fetch auction detail' },
      { status: 500 },
    );
  }
}
