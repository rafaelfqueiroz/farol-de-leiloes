import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmAdapter } from './adapters/llm.adapter.js';
import { NlpService } from './services/nlp.service.js';
import { AiController } from './ai.controller.js';

@Module({
  imports: [ConfigModule],
  controllers: [AiController],
  providers: [LlmAdapter, NlpService],
  exports: [NlpService],
})
export class AiModule {}
