import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OwnerCounterRepository } from './owner-counter.repository.js';
import { OwnerCounterEntity, OwnerCounterSchema } from './schemas/owner-counter.schema.js';

/**
 * SPEC-002 BR-002-13 / AR-15: the atomic plan-limit counters. Imported by the module that counts
 * something against a plan limit (SPEC-016 journeys); not part of the API until then, so the
 * collection exists only once a limit is enforced. Kept out of the global AccessModule, which
 * needs no database.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: OwnerCounterEntity.name, schema: OwnerCounterSchema }]),
  ],
  providers: [OwnerCounterRepository],
  exports: [OwnerCounterRepository],
})
export class OwnerCountersModule {}
