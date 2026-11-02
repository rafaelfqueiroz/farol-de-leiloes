import { NextRequest, NextResponse } from 'next/server';
import { errorMessage } from '@/lib/error-message';
import { reportClientError } from '@/lib/report-client-error';

const BACKEND_URL = process.env.NEXT_PUBLIC_AUCTIONS_API_URL || 'http://localhost:3000';

const FORWARDED_PARAMS = [
  'state',
  'city',
  'neighborhood',
  'modality',
  'minMargin',
  'maxMargin',
  'limit',
  'offset',
] as const;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    // Build query parameters
    const params = new URLSearchParams();

    for (const name of FORWARDED_PARAMS) {
      const value = searchParams.get(name);
      if (value) params.set(name, value);
    }

    const url = `${BACKEND_URL}/api/auctions?${params.toString()}`;

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
    reportClientError(error, { where: 'api/search GET' });
    return NextResponse.json(
      { error: errorMessage(error) || 'Failed to fetch auctions' },
      { status: 500 },
    );
  }
}
