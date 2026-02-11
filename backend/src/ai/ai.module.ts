import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmAdapter } from './adapters/llm.adapter';
import { NlpService } from './services/nlp.service';
import { AiController } from './ai.controller';

@Module({
  imports: [ConfigModule],
  controllers: [AiController],
  providers: [LlmAdapter, NlpService],
  exports: [NlpService],
})
export class AiModule {}
