import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_AUCTIONS_API_URL || 'http://localhost:3000';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');

    if (!authHeader) {
      return NextResponse.json(
        { message: 'No authorization header' },
        { status: 401 }
      );
    }

    const url = `${BACKEND_URL}/api/auth/resend-verification`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error resending verification email:', error);
    return NextResponse.json(
      { message: error.message || 'Failed to resend verification email' },
      { status: 500 }
    );
  }
}
