import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_AUCTIONS_API_URL || 'http://localhost:3000';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const response = await fetch(`${BACKEND_URL}/api/coupons/${id}/invalidate`, {
      method: 'PATCH',
      headers: { 'Authorization': authHeader },
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error invalidating coupon:', error);
    return NextResponse.json(
      { message: error.message || 'Failed to invalidate coupon' },
      { status: 500 },
    );
  }
}
