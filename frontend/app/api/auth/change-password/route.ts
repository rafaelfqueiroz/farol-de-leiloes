import { NextRequest, NextResponse } from 'next/server';
import { errorMessage } from '@/lib/error-message';
import { reportClientError } from '@/lib/report-client-error';

const BACKEND_URL = process.env.NEXT_PUBLIC_AUCTIONS_API_URL || 'http://localhost:3000';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');

    if (!authHeader) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const url = `${BACKEND_URL}/api/auth/change-password`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error: unknown) {
    reportClientError(error, { where: 'api/auth/change-password POST' });
    return NextResponse.json(
      { message: errorMessage(error) || 'Failed to change password' },
      { status: 500 },
    );
  }
}
