// AR-36: the launch checklist (SPEC-010 BR-010-24..26) for the operator. Platform state only: no
// validator name, no reference, no email, no account (SC-15).
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LEGAL_DOCUMENT_TYPES } from '../../domain/legal-versions.js';
import { LEGAL_VALIDATION_SCOPES } from '../../domain/legal-validation.js';
import type { LaunchChecklist } from '../../domain/launch-checklist.js';

export class ChecklistGateDto {
  @ApiProperty({ enum: LEGAL_VALIDATION_SCOPES, enumName: 'LegalValidationScope' })
  scope: string;

  @ApiProperty({ description: 'A recorded validation that still counts for what is in force now' })
  validated: boolean;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  validatedAt?: Date;

  @ApiPropertyOptional({ type: [String], example: ['terms:1.0', 'privacy:1.0'] })
  documentVersions?: string[];

  @ApiProperty({
    type: [String],
    description: 'What stays blocked while this gate is not validated',
  })
  blocks: string[];

  constructor(gate: LaunchChecklist['gates'][number]) {
    this.scope = gate.scope;
    this.validated = gate.validated;
    if (gate.validatedAt !== null) this.validatedAt = gate.validatedAt;
    if (gate.documentVersions !== null) this.documentVersions = [...gate.documentVersions];
    this.blocks = [...gate.blocks];
  }
}

export class DraftDocumentDto {
  @ApiProperty({ enum: LEGAL_DOCUMENT_TYPES, enumName: 'LegalDocumentType' })
  type: string;

  @ApiProperty({ type: String, example: '0.1' })
  version: string;

  constructor(draft: LaunchChecklist['drafts'][number]) {
    this.type = draft.type;
    this.version = draft.version;
  }
}

export class RetentionChecklistDto {
  @ApiProperty({
    description: 'DOCUMENT_RETENTION_YEARS: whole years closed journeys keep documents',
  })
  documentYears: number;

  @ApiProperty({ description: 'True until the lawyer validated the retention periods (BR-010-24)' })
  provisional: boolean;

  constructor(retention: LaunchChecklist['retention']) {
    this.documentYears = retention.documentYears;
    this.provisional = retention.provisional;
  }
}

export class LawyerSetPeriodDto {
  @ApiProperty()
  item: string;

  @ApiProperty({ description: 'Always false: nothing is deleted until the lawyer sets the period' })
  deleted: boolean;

  @ApiProperty()
  note: string;

  constructor(period: LaunchChecklist['lawyerSetPeriods'][number]) {
    this.item = period.item;
    this.deleted = period.deleted;
    this.note = period.note;
  }
}

export class ChecklistSettingsDto {
  @ApiProperty() termsEnforcementEnabled: boolean;
  @ApiProperty() accountPurgeEnabled: boolean;
  @ApiProperty() dataExportEnabled: boolean;
  @ApiProperty() documentRetentionEnabled: boolean;
  @ApiProperty({ description: 'R2_PRIVATE_BUCKET is set (exports and client files need it)' })
  privateBucketConfigured: boolean;
  @ApiProperty({ description: 'The @RequiresLegalValidation gate refuses in this environment' })
  legalGateEnforced: boolean;

  constructor(settings: LaunchChecklist['settings']) {
    this.termsEnforcementEnabled = settings.termsEnforcementEnabled;
    this.accountPurgeEnabled = settings.accountPurgeEnabled;
    this.dataExportEnabled = settings.dataExportEnabled;
    this.documentRetentionEnabled = settings.documentRetentionEnabled;
    this.privateBucketConfigured = settings.privateBucketConfigured;
    this.legalGateEnforced = settings.legalGateEnforced;
  }
}

/** AR-35 lookup exemption: a fixed, small checklist (four gates), not a browsable list. */
export class LaunchChecklistResponseDto {
  @ApiProperty({ type: () => [ChecklistGateDto] })
  gates: ChecklistGateDto[];

  @ApiProperty({
    type: () => [DraftDocumentDto],
    description: 'Current legal documents still marked draft',
  })
  drafts: DraftDocumentDto[];

  @ApiProperty({ type: () => RetentionChecklistDto })
  retention: RetentionChecklistDto;

  @ApiProperty({ type: () => [LawyerSetPeriodDto] })
  lawyerSetPeriods: LawyerSetPeriodDto[];

  @ApiProperty({ type: () => ChecklistSettingsDto })
  settings: ChecklistSettingsDto;

  @ApiProperty({ description: 'Every gate validated, no draft and the periods not provisional' })
  launchReady: boolean;

  constructor(checklist: LaunchChecklist) {
    this.gates = checklist.gates.map((gate) => new ChecklistGateDto(gate));
    this.drafts = checklist.drafts.map((draft) => new DraftDocumentDto(draft));
    this.retention = new RetentionChecklistDto(checklist.retention);
    this.lawyerSetPeriods = checklist.lawyerSetPeriods.map((p) => new LawyerSetPeriodDto(p));
    this.settings = new ChecklistSettingsDto(checklist.settings);
    this.launchReady = checklist.launchReady;
  }
}
