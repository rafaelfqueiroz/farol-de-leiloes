import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AdminOnly } from '../../access/decorators/access-guards.decorator.js';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { ApiJwtAuth } from '../../auth/decorators/api-jwt-auth.decorator.js';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import { AuctionDocumentsService } from './auction-documents.service.js';

export class MatriculaLinkResponseDto {
  @ApiProperty({ type: String, description: 'A download link, valid for expiresInSeconds' })
  url!: string;

  @ApiProperty({ type: 'integer', example: 60 })
  expiresInSeconds!: number;
}

/**
 * SPEC-004 BR-004-22, SC-18, SC-25: the matrícula copy is linked per request, 60 seconds, and for
 * PLATFORM ADMINS ONLY until SPEC-005 / SPEC-024 decide who else may open it (a persona, a plan,
 * an entitlement): the document names people, so no account that merely signed in gets it. Owner
 * decision, recorded in docs/runbooks/caixa-import.md. Throttled, and only a counter is logged.
 */
@ApiTags('auctions')
@ApiErrorResponses()
@Controller('auctions')
export class AuctionDocumentsController {
  constructor(private readonly documents: AuctionDocumentsService) {}

  @Get(':code/matricula-link')
  @UseGuards(ThrottlerGuard) // SC-04
  @ApiJwtAuth()
  @AdminOnly() // BR-002-23: users.isAdmin; a signed-in account that is not one sees 403
  @ApiOperation({
    summary:
      'A 60-second download link for the platform’s copy of a property’s matrícula (admin only, until SPEC-005 decides)',
  })
  @ApiOkResponse({ type: MatriculaLinkResponseDto })
  @ApiNotFoundResponse({ description: 'AUCTION_NOT_FOUND', type: ErrorResponseDto })
  async matriculaLink(@Param('code') code: string): Promise<MatriculaLinkResponseDto> {
    return this.documents.issueMatriculaLink(code);
  }
}
