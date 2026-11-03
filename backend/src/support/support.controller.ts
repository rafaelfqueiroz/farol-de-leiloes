import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SupportService } from './support.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiJwtAuth } from '../auth/decorators/api-jwt-auth.decorator';
import { AuthenticatedUser } from '../auth/interfaces/auth.interface';
import { CreateSupportRequestDto } from './dto/create-support-request.dto';
import { MessageResponseDto } from '../common/dto/message-response.dto';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator';

@ApiTags('support')
@ApiErrorResponses()
@ApiJwtAuth()
@Controller('support')
@UseGuards(JwtAuthGuard)
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
