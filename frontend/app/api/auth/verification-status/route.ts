import { NextRequest, NextResponse } from 'next/server';
import { errorMessage } from '@/lib/error-message';
import { reportClientError } from '@/lib/report-client-error';

const BACKEND_URL = process.env.NEXT_PUBLIC_AUCTIONS_API_URL || 'http://localhost:3000';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');

    if (!authHeader) {
      return NextResponse.json({ message: 'No authorization header' }, { status: 401 });
    }

    const url = `${BACKEND_URL}/api/auth/verification-status`;

    const response = await fetch(url, {
      headers: {
        Authorization: authHeader,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error: unknown) {
    reportClientError(error, { where: 'api/auth/verification-status GET' });
    return NextResponse.json(
      { message: errorMessage(error) || 'Failed to fetch verification status' },
      { status: 500 },
    );
  }
}
