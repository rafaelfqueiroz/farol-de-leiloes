// BR-001-04: a route behind ConfirmedEmailGuard documents its 403. The guard itself is applied with
// `@UseGuards(ConfirmedEmailGuard)` on the controller; this only adds the response to the OpenAPI
// document (AR-33).
import { ApiForbiddenResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';

export const ApiConfirmedEmail = () =>
  ApiForbiddenResponse({
    description: 'EMAIL_VERIFICATION_REQUIRED: the account has not confirmed its email (BR-001-04)',
    type: ErrorResponseDto,
  });
