import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StorageService } from './storage.service';
import r2Config from './r2.config';

@Module({
  imports: [
    ConfigModule.forFeature(r2Config),
  ],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
