// AR-33/AR-38: the documented shape of every error response, `{ code, context }`.
import { ApiProperty } from '@nestjs/swagger';
import { ERROR_CODES, type ErrorCode } from './codes.js';
import type { ErrorContext } from './domain-error.js';

export class ErrorResponseDto {
  @ApiProperty({
    enum: ERROR_CODES,
    enumName: 'ErrorCode',
    description: 'Stable code from the catalogue (AR-37); the frontend turns it into text',
  })
  code!: ErrorCode;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Ids, counts, limits and enum values only (AR-40), e.g. { fields } or { limit }',
    example: { fields: ['pageSize'] },
  })
  context!: ErrorContext;
}
