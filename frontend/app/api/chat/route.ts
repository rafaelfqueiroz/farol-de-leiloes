import { NextRequest } from 'next/server';
import { backendFetch, backendUnavailable, forwardBackendResponse } from '@/lib/backend';
import type { AuctionQueryParams } from '@/lib/constants';
import { reportClientError } from '@/lib/report-client-error';

export async function POST(request: NextRequest) {
  const body = await request.text();

  try {
    // Step 1: extract query parameters with the backend's AI service. The raw body goes through,
    // so the backend alone validates `message` and answers with its own code (AR-38).
    const extractResponse = await backendFetch('/ai/extract-params', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!extractResponse.ok) return forwardBackendResponse(extractResponse);

    const params: AuctionQueryParams = await extractResponse.json();

    // Step 2: query auctions with the extracted parameters.
    const queryParams = new URLSearchParams();
    if (params.state) queryParams.set('state', params.state);
    if (params.city) queryParams.set('city', params.city);
    if (params.neighborhood) queryParams.set('neighborhood', params.neighborhood);
    if (params.modality) queryParams.set('modality', params.modality);
    if (params.minMargin) queryParams.set('minMargin', params.minMargin.toString());
    if (params.maxMargin) queryParams.set('maxMargin', params.maxMargin.toString());
    // AR-35: the AI service answers with the same page/pageSize the list endpoint takes
    if (params.page) queryParams.set('page', params.page.toString());
    if (params.pageSize) queryParams.set('pageSize', params.pageSize.toString());

    return forwardBackendResponse(await backendFetch(`/auctions?${queryParams}`));
  } catch (error: unknown) {
    reportClientError(error, { where: 'api/chat POST' });
    return backendUnavailable();
  }
}
