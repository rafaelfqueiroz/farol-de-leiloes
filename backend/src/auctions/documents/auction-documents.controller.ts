import { Controller, Get, Param } from '@nestjs/common';
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
 * SPEC-004 BR-004-22, SC-18: the matrícula copy is linked per request. Not `@Public()`: a signed-in
 * account is required (SC-07), because the document names people. Which plan or persona may open
 * it is SPEC-005 / SPEC-024's decision; until then any signed-in account may.
 */
@ApiTags('auctions')
@ApiErrorResponses()
@Controller('auctions')
export class AuctionDocumentsController {
  constructor(private readonly documents: AuctionDocumentsService) {}

  @Get(':code/matricula-link')
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'A 60-second download link for the platform’s copy of a property’s matrícula',
  })
  @ApiOkResponse({ type: MatriculaLinkResponseDto })
  @ApiNotFoundResponse({ description: 'AUCTION_NOT_FOUND', type: ErrorResponseDto })
  async matriculaLink(@Param('code') code: string): Promise<MatriculaLinkResponseDto> {
    return this.documents.issueMatriculaLink(code);
  }
}
