import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator.js';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator.js';
import { SupportContactResponseDto } from './dto/support-request-response.dto.js';
import { SupportService } from './support.service.js';

/**
 * SPEC-009 BR-009-03: the support team's address, public: people who cannot sign in (a locked-out
 * account, a deactivated one) need it, and so does the FAQ for visitors. It is configuration the
 * deployment sets (SUPPORT_EMAIL, no default), so the frontend never carries a copy that can drift.
 */
@ApiTags('support')
@ApiErrorResponses()
@Controller('support')
export class SupportContactController {
  constructor(private readonly support: SupportService) {}

  // SC-07: explicitly public. It carries one configured address and no account data.
  @Public()
  @Get('contact')
  @ApiOperation({ summary: 'The support team’s email address (public)' })
  @ApiOkResponse({ type: SupportContactResponseDto })
  contact(): SupportContactResponseDto {
    return new SupportContactResponseDto(this.support.contactEmail());
  }
}
