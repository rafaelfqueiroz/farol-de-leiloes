// AR-33/AR-35: the OpenAPI shape of a paginated list. One schema for the envelope's metadata,
// extended per endpoint with `items` typed as the endpoint's own response DTO.
import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { MAX_PAGE_SIZE } from './pagination-query.dto.js';

/** The envelope without its items; `ApiPaginatedResponse(Model)` adds `items: Model[]`. */
export class PaginatedResponseDto {
  @ApiProperty({ type: 'integer', minimum: 0, description: 'Matches across all pages' })
  total!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE })
  pageSize!: number;
}

export function ApiPaginatedResponse(model: Type<unknown>) {
  return applyDecorators(
    ApiExtraModels(PaginatedResponseDto, model),
    ApiOkResponse({
      description: `A page of ${model.name}: { items, total, page, pageSize }`,
      schema: {
        allOf: [
          { $ref: getSchemaPath(PaginatedResponseDto) },
          {
            type: 'object',
            required: ['items'],
            properties: { items: { type: 'array', items: { $ref: getSchemaPath(model) } } },
          },
        ],
      },
    }),
  );
}
