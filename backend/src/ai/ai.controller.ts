import { Body, Controller, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NlpService } from './services/nlp.service';
import { ChatRequestDto, ChatResponseDto } from './dto/chat.dto';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator';

@ApiTags('ai')
@ApiErrorResponses()
@Controller('ai')
export class AiController {
  constructor(private readonly nlpService: NlpService) {}

  @Post('extract-params')
  @ApiOperation({ summary: 'Turn a search written in words into auction search parameters' })
  @ApiCreatedResponse({ type: ChatResponseDto })
  async extractParams(@Body() dto: ChatRequestDto): Promise<ChatResponseDto> {
    return new ChatResponseDto(await this.nlpService.extractQueryParams(dto.message));
  }
}
