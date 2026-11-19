import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator.js';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator.js';
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
  @Public()
  @Get()
  @ApiOperation({ summary: 'The offered plans with price, interval and journey limit (public)' })
  @ApiOkResponse({ type: PlansResponseDto })
  async list(): Promise<PlansResponseDto> {
    return new PlansResponseDto(await this.plans.listOffered());
  }
}
