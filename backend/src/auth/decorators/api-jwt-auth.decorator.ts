// AR-33: a route behind JwtAuthGuard documents the bearer token it needs and its 401. Kept next to
// the guard so the two travel together; the guard itself stays an explicit @UseGuards.
import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ApiUnauthenticatedResponse } from '../../common/errors/api-error-responses.decorator';

export const BEARER_AUTH = 'bearer';

export function ApiJwtAuth() {
  return applyDecorators(ApiBearerAuth(BEARER_AUTH), ApiUnauthenticatedResponse());
}
