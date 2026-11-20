// AR-36: the account's own acceptances (BR-010-04: which versions it accepted, and when).
import { ApiProperty } from '@nestjs/swagger';
import { ACCEPTANCE_METHODS, LEGAL_DOCUMENT_TYPES } from '../domain/legal-versions.js';
import type { AcceptanceRecord } from '../consents.repository.js';

export class AcceptanceResponseDto {
  @ApiProperty({ enum: LEGAL_DOCUMENT_TYPES, enumName: 'LegalDocumentType' })
  documentType: string;

  @ApiProperty({ type: String, example: '0.1' })
  version: string;

  @ApiProperty({ type: String, format: 'date-time' })
  acceptedAt: Date;

  @ApiProperty({ enum: ACCEPTANCE_METHODS, enumName: 'AcceptanceMethod' })
  method: string;

  constructor(record: AcceptanceRecord) {
    this.documentType = record.documentType;
    this.version = record.version;
    this.acceptedAt = record.acceptedAt;
    this.method = record.method;
  }
}

/** AR-35 lookup exemption: one account has a handful of acceptances (two per published version). */
export class AcceptancesResponseDto {
  @ApiProperty({ type: () => [AcceptanceResponseDto], description: 'Newest first' })
  items: AcceptanceResponseDto[];

  constructor(records: readonly AcceptanceRecord[]) {
    this.items = records.map((record) => new AcceptanceResponseDto(record));
  }
}
