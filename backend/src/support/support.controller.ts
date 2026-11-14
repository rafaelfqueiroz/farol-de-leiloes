import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SupportService } from './support.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ApiJwtAuth } from '../auth/decorators/api-jwt-auth.decorator.js';
import { AuthenticatedUser } from '../auth/interfaces/auth.interface.js';
import { CreateSupportRequestDto } from './dto/create-support-request.dto.js';
import { MessageResponseDto } from '../common/dto/message-response.dto.js';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator.js';

@ApiTags('support')
@ApiErrorResponses()
@ApiJwtAuth()
@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a support request to the team by email' })
  @ApiOkResponse({ type: MessageResponseDto })
  async submitSupportRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSupportRequestDto,
  ): Promise<MessageResponseDto> {
    const result = await this.supportService.submitSupportRequest(
      user.userId,
      user.email,
      user.name,
      dto,
    );
    return new MessageResponseDto(result.message);
  }
}
