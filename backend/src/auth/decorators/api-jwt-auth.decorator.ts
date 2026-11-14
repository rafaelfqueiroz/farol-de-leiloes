// AR-33: a route behind JwtAuthGuard documents the bearer token it needs and its 401. Kept next to
// the globally registered guard; @Public() is the explicit opt-out (SC-07).
import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ApiUnauthenticatedResponse } from '../../common/errors/api-error-responses.decorator.js';

export const BEARER_AUTH = 'bearer';

export function ApiJwtAuth() {
  return applyDecorators(ApiBearerAuth(BEARER_AUTH), ApiUnauthenticatedResponse());
}
