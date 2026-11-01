import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_AUCTIONS_API_URL || 'http://localhost:3000';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');

    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = `${BACKEND_URL}/api/favorites`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error fetching favorites:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch favorites' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log(
      '[API Route] POST /api/favorites - All headers:',
      Object.fromEntries(request.headers.entries()),
    );
    const authHeader = request.headers.get('Authorization');
    console.log('[API Route] POST /api/favorites - Authorization header:', authHeader);

    if (!authHeader) {
      console.log('[API Route] POST /api/favorites - No Authorization header found, returning 401');
      return NextResponse.json({ error: 'Unauthorized - No token provided' }, { status: 401 });
    }

    const body = await request.json();
    const url = `${BACKEND_URL}/api/favorites`;
    console.log('[API Route] Forwarding to backend URL:', url);
    console.log('[API Route] Request body:', JSON.stringify(body));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    });

    console.log('[API Route] Backend response status:', response.status);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      console.log('[API Route] Backend error:', errorData);
      return NextResponse.json(
        { error: errorData.message || `Backend error: ${response.statusText}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    console.log('[API Route] Backend success, returning data');

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error creating favorite:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create favorite' },
      { status: 500 },
    );
  }
}
