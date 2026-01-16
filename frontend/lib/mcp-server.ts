import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AUCTIONS_API_URL } from './constants.js';

// Schema for auction query filters
const QueryFiltersSchema = z.object({
  state: z.string().optional(),
  city: z.string().optional(),
  neighborhood: z.string().optional(),
  modality: z.string().optional(),
  minMargin: z.number().optional(),
  maxMargin: z.number().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});

export class AuctionsMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'auctions-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'query_auctions',
            description:
              'Query auctions from the Caixa Economica Federal database. Supports filtering by state, city, neighborhood, modality, and price range.',
            inputSchema: {
              type: 'object',
              properties: {
                state: {
                  type: 'string',
                  description: 'State abbreviation (e.g., RN, SP, RJ)',
                },
                city: {
                  type: 'string',
                  description: 'City name (e.g., Natal, São Paulo)',
                },
                neighborhood: {
                  type: 'string',
                  description: 'Neighborhood name',
                },
                modality: {
                  type: 'string',
                  description:
                    'Auction modality: FIRST_AUCTION, SECOND_AUCTION, OPEN_BIDDING, DIRECT_ONLINE_SALES, or ONLINE_SALES',
                },
                minMargin: {
                  type: 'number',
                  description: 'Minimum price filter (in BRL)',
                },
                maxMargin: {
                  type: 'number',
                  description: 'Maximum price filter (in BRL)',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 10)',
                },
                offset: {
                  type: 'number',
                  description: 'Number of results to skip for pagination',
                },
              },
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === 'query_auctions') {
        const filters = QueryFiltersSchema.parse(request.params.arguments);

        try {
          const queryParams = new URLSearchParams();
          if (filters.state) queryParams.set('state', filters.state);
          if (filters.city) queryParams.set('city', filters.city);
          if (filters.neighborhood) queryParams.set('neighborhood', filters.neighborhood);
          if (filters.modality) queryParams.set('modality', filters.modality);
          if (filters.minMargin) queryParams.set('minMargin', filters.minMargin.toString());
          if (filters.maxMargin) queryParams.set('maxMargin', filters.maxMargin.toString());
          if (filters.limit) queryParams.set('limit', filters.limit.toString());
          if (filters.offset) queryParams.set('offset', filters.offset.toString());

          const response = await fetch(`${AUCTIONS_API_URL}/api/auctions?${queryParams}`);

          if (!response.ok) {
            throw new Error(`API request failed: ${response.statusText}`);
          }

          const data = await response.json();

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(data, null, 2),
              },
            ],
          };
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [
              {
                type: 'text',
                text: `Error querying auctions: ${errorMessage}`,
              },
            ],
            isError: true,
          };
        }
      }

      throw new Error(`Unknown tool: ${request.params.name}`);
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Auctions MCP server running on stdio');
  }
}

// Run server when executed directly
const server = new AuctionsMCPServer();
server.run().catch(console.error);
