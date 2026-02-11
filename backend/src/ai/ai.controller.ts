import { Body, Controller, Post } from '@nestjs/common';
import { NlpService } from './services/nlp.service';
import { ChatRequestDto, ChatResponseDto } from './dto/chat.dto';

@Controller('ai')
export class AiController {
  constructor(private readonly nlpService: NlpService) {}

  @Post('extract-params')
  async extractParams(@Body() dto: ChatRequestDto): Promise<ChatResponseDto> {
    return this.nlpService.extractQueryParams(dto.message);
  }
}
