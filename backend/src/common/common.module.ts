import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JobExecution, JobExecutionSchema } from './schemas/job-execution.schema';
import { JobExecutionService } from './services/job-execution.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: JobExecution.name, schema: JobExecutionSchema }])],
  providers: [JobExecutionService],
  exports: [JobExecutionService],
})
export class CommonModule {}
