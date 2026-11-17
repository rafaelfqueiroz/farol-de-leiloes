import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PlansController } from './plans.controller.js';
import { PlansRepository } from './plans.repository.js';
import { PlansService } from './plans.service.js';
import { PlanEntity, PlanSchema } from './schemas/plan.schema.js';

/** SPEC-012 BR-012-01..BR-012-05: the plan catalog and its public listing. */
@Module({
  imports: [MongooseModule.forFeature([{ name: PlanEntity.name, schema: PlanSchema }])],
  controllers: [PlansController],
  providers: [PlansRepository, PlansService],
  exports: [PlansService],
})
export class PlansModule {}
