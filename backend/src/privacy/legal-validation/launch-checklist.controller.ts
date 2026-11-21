import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '../../access/decorators/access-guards.decorator.js';
import { ApiJwtAuth } from '../../auth/decorators/api-jwt-auth.decorator.js';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator.js';
import { LaunchChecklistResponseDto } from './dto/launch-checklist-response.dto.js';
import { LaunchChecklistService } from './launch-checklist.service.js';

/**
 * SPEC-010 BR-010-24..26: what the F1 launch still waits on. Platform operation only (`@AdminOnly`,
 * SPEC-002 BR-002-23); it reads no account and holds no personal data. Read-only: validations are
 * recorded with `npm run legal:record-validation`, never through the API.
 */
@ApiTags('admin')
@ApiErrorResponses()
@Controller('admin/launch-checklist')
export class LaunchChecklistController {
  constructor(private readonly checklist: LaunchChecklistService) {}

  // The answer changes the moment a validation is recorded or a setting flips: never cached.
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiJwtAuth()
  @AdminOnly()
  @ApiOperation({
    summary:
      'The launch checklist: lawyer validations, draft documents, retention, settings (admin)',
    description:
      'Per validation scope whether it is recorded and still counts (a new document version or a ' +
      'changed retention period reopens it), what stays blocked meanwhile, the current legal ' +
      'documents still marked draft, whether the retention periods are provisional, the periods the ' +
      'lawyer sets (nothing is deleted until then), the relevant settings, and `launchReady`. No ' +
      'validator name and no account data (BR-010-24..26).',
  })
  @ApiOkResponse({ type: LaunchChecklistResponseDto })
  async get(): Promise<LaunchChecklistResponseDto> {
    return new LaunchChecklistResponseDto(await this.checklist.checklist());
  }
}
