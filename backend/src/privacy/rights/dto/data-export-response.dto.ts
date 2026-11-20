// AR-36: an export leaves the API through this class, each field copied explicitly. The file key never
// does (SC-18): a download is a 60-second link issued per request.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EXPORT_ERROR_CODES, EXPORT_STATUSES } from '../../domain/data-export.js';
import type { DataExportView } from '../data-export.service.js';

export class DataExportResponseDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ enum: EXPORT_STATUSES, enumName: 'DataExportStatus' })
  status: string;

  @ApiProperty({ type: String, format: 'date-time' })
  requestedAt: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'When the file became ready',
  })
  readyAt?: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'From this instant the download is refused (ready + 7 days, half-open)',
  })
  expiresAt?: Date;

  @ApiPropertyOptional({ enum: EXPORT_ERROR_CODES, enumName: 'DataExportErrorCode' })
  errorCode?: string;

  constructor(view: DataExportView) {
    this.id = view.id;
    this.status = view.status;
    this.requestedAt = view.requestedAt;
    this.readyAt = view.readyAt;
    this.expiresAt = view.expiresAt;
    this.errorCode = view.errorCode;
  }
}

export class DataExportLinkResponseDto {
  @ApiProperty({ type: String, description: 'Signed link to the file; never store or log it' })
  url: string;

  @ApiProperty({ type: Number, example: 60, description: 'Seconds the link works for' })
  expiresInSeconds: number;

  constructor(link: { url: string; expiresInSeconds: number }) {
    this.url = link.url;
    this.expiresInSeconds = link.expiresInSeconds;
  }
}
