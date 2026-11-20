import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator.js';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator.js';
import { DomainError } from '../common/errors/domain-error.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { AllowWithoutTerms } from './decorators/allow-without-terms.decorator.js';
import type { LegalDocumentType } from './domain/legal-versions.js';
import {
  CurrentLegalDocumentsResponseDto,
  LegalDocumentResponseDto,
  LegalVersionParamsDto,
  LegalVersionsResponseDto,
} from './dto/legal-document-response.dto.js';
import { LegalDocumentsService } from './legal-documents.service.js';

/**
 * SPEC-010 BR-010-02, BR-010-04: the terms of use and the privacy policy, reachable without an
 * account (from every page and from the sign-up screen). Public (SC-07), read-only, and served
 * from the registry in memory, so a visitor's request reads no database. The texts carry no
 * account data and a published version never changes, hence the cache headers.
 */
@ApiTags('legal')
@ApiErrorResponses()
@Public()
@AllowWithoutTerms() // also public; stated so the exemption does not depend on @Public()
@Controller('legal')
export class LegalController {
  constructor(private readonly legal: LegalDocumentsService) {}

  @Get('current')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({
    summary: 'The terms of use and the privacy policy in force now, with their texts (public)',
    description:
      'The version of each document with the latest effective date not in the future ' +
      '(BR-010-05). Sign-up sends back the versions it shows (BR-010-01). A placeholder text says ' +
      'so in `banner` and `draft` until the lawyer reviews it (BR-010-26).',
  })
  @ApiOkResponse({ type: CurrentLegalDocumentsResponseDto })
  current(): CurrentLegalDocumentsResponseDto {
    return new CurrentLegalDocumentsResponseDto(this.legal.current());
  }

  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({
    summary:
      'Every published version of the terms and the privacy policy with its effective date (public)',
    description:
      'Versions in force or past, by document and newest first, without their texts (BR-010-04). ' +
      'A version not yet in force is not listed. AR-35 lookup exemption: a handful of versions, ' +
      'read at once.',
  })
  @ApiOkResponse({ type: LegalVersionsResponseDto })
  list(): LegalVersionsResponseDto {
    return new LegalVersionsResponseDto(this.legal.list());
  }

  @Get(':type/:version')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({
    summary: 'One published version of a legal document, with its text (public)',
    description:
      'NOT_FOUND (404) for a version that does not exist or is not in force yet. A published ' +
      'version never changes (its hash is pinned), so the answer is cacheable.',
  })
  @ApiOkResponse({ type: LegalDocumentResponseDto })
  @ApiNotFoundResponse({ description: 'NOT_FOUND', type: ErrorResponseDto })
  version(@Param() params: LegalVersionParamsDto): LegalDocumentResponseDto {
    const found = this.legal.find(params.type as LegalDocumentType, params.version);
    if (found === null) throw new DomainError('NOT_FOUND');
    return new LegalDocumentResponseDto(found);
  }
}
