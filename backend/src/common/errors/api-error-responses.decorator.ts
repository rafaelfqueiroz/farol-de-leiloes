// AR-33/AR-38: every operation documents its error shape. Applied once per controller: the 400
// (VALIDATION_FAILED and other client errors), the 500 every route can answer, and a `default`
// covering the domain codes of the catalogue (statuses in error-status.ts).
import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiDefaultResponse,
  ApiInternalServerErrorResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from './error-response.dto.js';

export function ApiErrorResponses() {
  return applyDecorators(
    ApiBadRequestResponse({
      description: 'VALIDATION_FAILED ({ fields }) or another client error',
      type: ErrorResponseDto,
    }),
    ApiInternalServerErrorResponse({ description: 'INTERNAL_ERROR', type: ErrorResponseDto }),
    ApiDefaultResponse({
      description: 'Any other error code of the catalogue, with its status (AR-38)',
      type: ErrorResponseDto,
    }),
  );
}

/** A route behind JwtAuthGuard also answers 401 UNAUTHENTICATED. */
export function ApiUnauthenticatedResponse() {
  return ApiUnauthorizedResponse({ description: 'UNAUTHENTICATED', type: ErrorResponseDto });
}
