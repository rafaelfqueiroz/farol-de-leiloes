import { NextRequest, NextResponse } from 'next/server';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:3000';

interface AuctionQueryParams {
  state?: string;
  city?: string;
  neighborhood?: string;
  modality?: string;
  minMargin?: number;
  maxMargin?: number;
  limit?: number;
  offset?: number;
}

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json();

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Step 1: Extract query parameters using backend AI/NLP service
    const extractResponse = await fetch(`${BACKEND_API_URL}/ai/extract-params`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    if (!extractResponse.ok) {
      throw new Error(`Failed to extract params: ${extractResponse.statusText}`);
    }

    const params: AuctionQueryParams = await extractResponse.json();

    // Step 2: Query auctions directly with extracted parameters
    const queryParams = new URLSearchParams();
    if (params.state) queryParams.set('state', params.state);
    if (params.city) queryParams.set('city', params.city);
    if (params.neighborhood) queryParams.set('neighborhood', params.neighborhood);
    if (params.modality) queryParams.set('modality', params.modality);
    if (params.minMargin) queryParams.set('minMargin', params.minMargin.toString());
    if (params.maxMargin) queryParams.set('maxMargin', params.maxMargin.toString());
    if (params.limit) queryParams.set('limit', params.limit.toString());
    if (params.offset) queryParams.set('offset', params.offset.toString());

    const auctionsResponse = await fetch(`${BACKEND_API_URL}/auctions?${queryParams}`);

    if (!auctionsResponse.ok) {
      throw new Error(`Failed to query auctions: ${auctionsResponse.statusText}`);
    }

    const results = await auctionsResponse.json();

    return NextResponse.json(results);
  } catch (error: unknown) {
    console.error('Error in chat API:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
