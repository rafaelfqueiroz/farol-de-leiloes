import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

// AR-48: GET /api/health. The MongoDB connection is the root one (AppModule); the last import
// comes from JobExecutionService (AR-09: another module's data through its service).
@Module({
  imports: [CommonModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
