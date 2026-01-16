import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { AuctionQueryParams, AuctionResult } from './constants';

export class AuctionsMCPClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private serverProcess: ChildProcess | null = null;

  async connect(): Promise<void> {
    // Spawn MCP server as subprocess
    const serverPath = path.join(process.cwd(), 'lib', 'mcp-server.ts');

    this.serverProcess = spawn('npx', ['tsx', serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        AUCTIONS_API_URL: process.env.AUCTIONS_API_URL || process.env.NEXT_PUBLIC_AUCTIONS_API_URL || 'http://localhost:3000',
      },
    });

    // Log stderr for debugging
    this.serverProcess.stderr?.on('data', (data) => {
      console.error(`MCP Server stderr: ${data}`);
    });

    // Create transport using the subprocess stdio
    this.transport = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', serverPath],
      env: {
        ...process.env,
        AUCTIONS_API_URL: process.env.AUCTIONS_API_URL || process.env.NEXT_PUBLIC_AUCTIONS_API_URL || 'http://localhost:3000',
      },
    });

    // Create and connect the client
    this.client = new Client(
      {
        name: 'auctions-mcp-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    await this.client.connect(this.transport);
  }

  async queryAuctions(params: AuctionQueryParams): Promise<AuctionResult> {
    if (!this.client) {
      throw new Error('MCP client not connected. Call connect() first.');
    }

    try {
      const result = await this.client.callTool({
        name: 'query_auctions',
        arguments: params as unknown as Record<string, unknown>,
      });

      // Check if result indicates an error
      if ((result as any).isError) {
        const content = result.content as Array<{ type: string; text?: string }>;
        const textContent = content.find((block) => block.type === 'text');
        throw new Error(textContent?.text || 'MCP tool returned an error');
      }

      // Parse the response - result.content is an array of content blocks
      const content = result.content as Array<{ type: string; text?: string }>;
      const textContent = content.find((block) => block.type === 'text');

      if (!textContent || !textContent.text) {
        throw new Error('No text content in MCP response');
      }

      // Check if the response is an error message (starts with "Error")
      if (textContent.text.startsWith('Error')) {
        throw new Error(textContent.text);
      }

      return JSON.parse(textContent.text);
    } catch (error) {
      console.error('Error calling query_auctions:', error);
      throw error;
    }
  }

  async listTools(): Promise<string[]> {
    if (!this.client) {
      throw new Error('MCP client not connected. Call connect() first.');
    }

    const result = await this.client.listTools();
    return result.tools.map((tool) => tool.name);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }

    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }

    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }
  }
}

// Singleton instance for reuse
let clientInstance: AuctionsMCPClient | null = null;

export async function getAuctionsMCPClient(): Promise<AuctionsMCPClient> {
  if (!clientInstance) {
    clientInstance = new AuctionsMCPClient();
    await clientInstance.connect();
  }
  return clientInstance;
}

export async function closeAuctionsMCPClient(): Promise<void> {
  if (clientInstance) {
    await clientInstance.disconnect();
    clientInstance = null;
  }
}
