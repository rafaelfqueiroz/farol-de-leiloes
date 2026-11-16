import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CommonModule } from '../common/common.module.js';
import { MaintenanceController } from './maintenance.controller.js';
import { MaintenanceRepository } from './maintenance.repository.js';
import { MaintenanceService } from './maintenance.service.js';
import { MaintenanceStore } from './maintenance.store.js';
import {
  MaintenanceWindowEntity,
  MaintenanceWindowSchema,
} from './schemas/maintenance-window.schema.js';

// SPEC-003 BR-003-03. The availability report (SPEC-003 BR-003-01, #115) reads the windows
// through MaintenanceService and the domain's countsAsExcluded / isExcludedAt.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MaintenanceWindowEntity.name, schema: MaintenanceWindowSchema },
    ]),
    CommonModule, // AR-24: the Clock
  ],
  controllers: [MaintenanceController],
  providers: [MaintenanceService, { provide: MaintenanceStore, useClass: MaintenanceRepository }],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
