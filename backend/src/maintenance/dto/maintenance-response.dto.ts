// AR-36: a maintenance window leaves the API through these classes, each field copied explicitly.
import { ApiProperty } from '@nestjs/swagger';
import { announcedInTime } from '../domain/maintenance-window.js';
import type { MaintenanceRecord } from '../maintenance-record.js';

/** What every visitor learns: when, what to say, and whether it will count as downtime. */
export class UpcomingMaintenanceDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String, format: 'date-time', description: 'UTC instant' })
  startsAt: Date;

  @ApiProperty({ type: String, format: 'date-time', description: 'UTC instant (expected end)' })
  endsAt: Date;

  @ApiProperty({ type: String, description: 'pt-BR announcement text' })
  message: string;

  @ApiProperty({
    type: Boolean,
    description: 'BR-003-03: announced at least 48 h before the start; false counts as downtime',
  })
  announcedInTime: boolean;

  constructor(record: MaintenanceRecord) {
    this.id = record.id;
    this.startsAt = record.startsAt;
    this.endsAt = record.endsAt;
    this.message = record.message;
    this.announcedInTime = announcedInTime(record);
  }
}

/** Not a bare array (AR-35 exemption: the banner needs the whole short list at once). */
export class UpcomingMaintenanceResponseDto {
  @ApiProperty({
    type: () => [UpcomingMaintenanceDto],
    description: 'In progress or starting within 14 days, soonest first, at most 20',
  })
  items: UpcomingMaintenanceDto[];

  constructor(records: MaintenanceRecord[]) {
    this.items = records.map((record) => new UpcomingMaintenanceDto(record));
  }
}

/** The admin view: the public fields plus when it was announced and by whom. */
export class MaintenanceWindowResponseDto extends UpcomingMaintenanceDto {
  @ApiProperty({ type: String, format: 'date-time', description: 'Set by the server at creation' })
  announcedAt: Date;

  @ApiProperty({ type: String, description: 'Admin account id' })
  createdBy: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  constructor(record: MaintenanceRecord) {
    super(record);
    this.announcedAt = record.announcedAt;
    this.createdBy = record.createdBy;
    this.createdAt = record.createdAt;
  }
}
