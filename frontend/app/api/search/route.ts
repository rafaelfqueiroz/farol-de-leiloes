import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_AUCTIONS_API_URL || 'http://localhost:3000';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    // Build query parameters
    const params = new URLSearchParams();

    if (searchParams.get('state')) params.set('state', searchParams.get('state')!);
    if (searchParams.get('city')) params.set('city', searchParams.get('city')!);
    if (searchParams.get('neighborhood'))
      params.set('neighborhood', searchParams.get('neighborhood')!);
    if (searchParams.get('modality')) params.set('modality', searchParams.get('modality')!);
    if (searchParams.get('minMargin')) params.set('minMargin', searchParams.get('minMargin')!);
    if (searchParams.get('maxMargin')) params.set('maxMargin', searchParams.get('maxMargin')!);
    if (searchParams.get('limit')) params.set('limit', searchParams.get('limit')!);
    if (searchParams.get('offset')) params.set('offset', searchParams.get('offset')!);

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
  } catch (error: any) {
    console.error('Error fetching auctions:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch auctions' },
      { status: 500 },
    );
  }
}
