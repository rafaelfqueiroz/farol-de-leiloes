import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator.js';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { PlansResponseDto } from './dto/plan-response.dto.js';
import { PlansService } from './plans.service.js';

/** SPEC-012 BR-012-05: anyone can see the offered plans. */
@ApiTags('plans')
@ApiErrorResponses()
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  // SC-07: explicitly public; a visitor who tries to subscribe is sent to sign in by the frontend
  // (BR-012-05). AR-35 lookup exemption: the offered catalog is a handful of entries read at once,
  // answered unpaginated in an `{ items }` envelope (listed in ARCHITECTURE AR-35).
  //
  // A public catalog read by every visitor: cached for 30 s by browsers and proxies, and a coarse
  // per-origin throttle as a flood guard (SC-04). The catalog is operator configuration, so 30 s of
  // staleness after a change is harmless.
  @Public()
  @Get()
  @UseGuards(ThrottlerGuard)
  @Header('Cache-Control', 'public, max-age=30')
  @ApiOperation({ summary: 'The offered plans with price, interval and journey limit (public)' })
  @ApiOkResponse({ type: PlansResponseDto })
  @ApiTooManyRequestsResponse({ description: 'TOO_MANY_REQUESTS', type: ErrorResponseDto })
  async list(): Promise<PlansResponseDto> {
    return new PlansResponseDto(await this.plans.listOffered());
  }
}
