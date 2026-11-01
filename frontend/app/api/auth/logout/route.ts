import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_AUCTIONS_API_URL || 'http://localhost:3000';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const url = `${BACKEND_URL}/api/auth/logout`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader || '',
      },
    });

    if (!response.ok) {
      return NextResponse.json({ message: 'Logout failed' }, { status: response.status });
    }

    return NextResponse.json({ message: 'Logged out successfully' });
  } catch (error: any) {
    console.error('Error logging out:', error);
    return NextResponse.json({ message: error.message || 'Failed to logout' }, { status: 500 });
  }
}
