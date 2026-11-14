// AR-36/AR-48: the health body, mapped explicitly. Statuses, a timestamp, an age and a flag only:
// no error detail, version or host name, since the endpoint is public.
import { ApiProperty } from '@nestjs/swagger';
import type { HealthReport } from '../domain/health-report.js';

export class DatabaseHealthDto {
  @ApiProperty({ enum: ['up', 'down'] })
  status!: 'up' | 'down';
}

export class LastImportHealthDto {
  @ApiProperty({
    enum: ['SUCCESS', 'FAILED', 'NEVER'],
    description: 'Outcome of the last Caixa import run, in any run mode',
  })
  status!: 'SUCCESS' | 'FAILED' | 'NEVER';

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  finishedAt!: string | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Hours since the run finished' })
  ageHours!: number | null;

  @ApiProperty({ description: 'Older than 26 hours, or never ran' })
  stale!: boolean;
}

export class HealthResponseDto {
  @ApiProperty({
    enum: ['ok', 'degraded', 'down'],
    description:
      'down (HTTP 503): database unreachable. degraded: the last import failed, is stale or never ran',
  })
  status!: 'ok' | 'degraded' | 'down';

  @ApiProperty({ type: DatabaseHealthDto })
  database!: DatabaseHealthDto;

  @ApiProperty({ type: LastImportHealthDto })
  lastImport!: LastImportHealthDto;

  static from(report: HealthReport): HealthResponseDto {
    const { status, finishedAt, ageHours, stale } = report.lastImport;
    return Object.assign(new HealthResponseDto(), {
      status: report.status,
      database: Object.assign(new DatabaseHealthDto(), { status: report.database.status }),
      lastImport: Object.assign(new LastImportHealthDto(), { status, finishedAt, ageHours, stale }),
    });
  }
}
