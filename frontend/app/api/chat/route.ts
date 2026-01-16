import { NextRequest, NextResponse } from 'next/server';
import { extractQueryParams } from '@/lib/nlp-preprocessor';
import { AuctionsMCPClient } from '@/lib/mcp-client';

export async function POST(req: NextRequest) {
  let mcpClient: AuctionsMCPClient | null = null;

  try {
    const { message } = await req.json();

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Step 1: NLP preprocessing with Claude to extract query parameters
    const params = await extractQueryParams(message);

    // Step 2: Query via MCP server
    mcpClient = new AuctionsMCPClient();
    await mcpClient.connect();
    const results = await mcpClient.queryAuctions(params);

    // Return raw search results
    return NextResponse.json(results);
  } catch (error: unknown) {
    console.error('Error in chat API:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  } finally {
    // Always clean up MCP client
    if (mcpClient) {
      try {
        await mcpClient.disconnect();
      } catch (disconnectError) {
        console.error('Error disconnecting MCP client:', disconnectError);
      }
    }
  }
}
