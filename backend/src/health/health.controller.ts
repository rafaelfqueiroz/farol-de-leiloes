import { Public } from '../auth/decorators/public.decorator';
import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator';
import { HealthResponseDto } from './dto/health-response.dto';
import { HealthService } from './health.service';

// AR-48/SC-07: explicitly public: the container HEALTHCHECK, the deploy check and the availability
// probe (SPEC-003 BR-003-02) call it unauthenticated. 503 only when the database is unreachable;
// a degraded import still answers 200, since the API keeps serving.
@ApiTags('health')
@ApiErrorResponses()
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Database reachability and the outcome and age of the last import' })
  @ApiOkResponse({ type: HealthResponseDto, description: 'ok or degraded' })
  @ApiServiceUnavailableResponse({
    type: HealthResponseDto,
    description: 'down: database unreachable',
  })
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponseDto> {
    const report = await this.health.check();
    if (report.status === 'down') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return HealthResponseDto.from(report);
  }
}
