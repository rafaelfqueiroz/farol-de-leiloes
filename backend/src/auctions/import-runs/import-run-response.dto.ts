// AR-36: an Import Run leaves the API through this class, each field copied explicitly (SPEC-004
// BR-004-27, BR-004-28). Dates, counts and CODES only: no list row, no message, no address, no
// person (SC-15). The frontend turns the codes into pt-BR text (AR-39).
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IMPORT_OUTCOMES, type ImportOutcome, type ImportRunRecord } from './import-run.js';
import type { NonBusinessReason } from './import-run.js';

export class ImportRunResponseDto {
  @ApiProperty({
    type: String,
    example: '2026-11-23',
    description: 'The Brasília day of the run, YYYY-MM-DD',
  })
  brasiliaDate: string;

  @ApiProperty({ type: String, format: 'date-time', description: 'UTC instant the run began' })
  startedAt: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'UTC instant the run ended; null while it is still RUNNING',
  })
  endedAt: Date | null;

  @ApiProperty({
    enum: IMPORT_OUTCOMES,
    description:
      'RUNNING (open), SUCCESS (list applied), FAILED, REJECTED_LIST, NO_NEW_LIST (a business day), NO_UPDATE (weekend or holiday, not a failure)',
  })
  outcome: ImportOutcome;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-11-23',
    description: 'The day Caixa generated the last list read (YYYY-MM-DD); null when none was read',
  })
  listGeneratedOn: string | null;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Distinct property numbers of that list',
  })
  rowCount: number;

  @ApiProperty({ type: 'integer', minimum: 0, description: 'Attempts of the day' })
  attempts: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  newCount: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  changedCount: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  unavailableCount: number;

  @ApiProperty({ type: 'integer', minimum: 0, description: 'Active properties after the run' })
  activeCount: number;

  @ApiProperty({ type: 'integer', minimum: 0, description: 'Detail pages collected' })
  detailsCollected: number;

  @ApiProperty({ type: 'integer', minimum: 0, description: 'Detail pages that failed' })
  detailsFailed: number;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Detail pages requested from Caixa that day: what the daily budget counts',
  })
  detailsPages: number;

  @ApiProperty({ type: Boolean, description: 'Caixa blocked the detail collection of the run' })
  blocked: boolean;

  @ApiProperty({
    type: [String],
    example: ['TRUNCATED_LIST'],
    description: 'Stable reason CODES, never text; the frontend maps them to pt-BR (AR-39)',
  })
  failureReasons: string[];

  @ApiPropertyOptional({
    enum: ['WEEKEND', 'HOLIDAY'],
    nullable: true,
    description: 'For NO_UPDATE: why the day is not a business day; null otherwise',
  })
  nonBusinessReason: NonBusinessReason | null;

  constructor(record: ImportRunRecord) {
    this.brasiliaDate = record.brasiliaDate;
    this.startedAt = record.startedAt;
    this.endedAt = record.finishedAt;
    this.outcome = record.outcome;
    this.listGeneratedOn = record.listGeneratedAt;
    this.rowCount = record.listRows;
    this.attempts = record.attempts;
    this.newCount = record.counts.new;
    this.changedCount = record.counts.changed;
    this.unavailableCount = record.counts.unavailable;
    this.activeCount = record.counts.active;
    this.detailsCollected = record.collection.collected;
    this.detailsFailed = record.collection.failed;
    this.detailsPages = record.collection.pages;
    this.blocked = record.collection.blocked;
    this.failureReasons = [...record.failureReasons];
    this.nonBusinessReason = record.nonBusinessReason;
  }
}

/** BR-004-24: when the last daily update finished. */
export class LastUpdateResponseDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'UTC instant the last daily update finished (BR-004-24); null before the first one. The frontend shows it in Brasília time',
  })
  finishedAt: Date | null;

  constructor(finishedAt: Date | null) {
    this.finishedAt = finishedAt;
  }
}
