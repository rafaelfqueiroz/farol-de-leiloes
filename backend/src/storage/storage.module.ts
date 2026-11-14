import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StorageService } from './storage.service.js';
import r2Config from '../config/r2.config.js';

@Module({
  imports: [ConfigModule.forFeature(r2Config)],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
