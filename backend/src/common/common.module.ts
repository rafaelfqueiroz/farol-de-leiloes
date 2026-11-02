import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Clock, SystemClock } from './clock/clock';
import { JobExecution, JobExecutionSchema } from './schemas/job-execution.schema';
import { JobExecutionService } from './services/job-execution.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: JobExecution.name, schema: JobExecutionSchema }])],
  // AR-24: the one place the real clock is bound; tests override `Clock` with FakeClock (TS-06).
  providers: [JobExecutionService, { provide: Clock, useClass: SystemClock }],
  exports: [JobExecutionService, Clock],
})
export class CommonModule {}
