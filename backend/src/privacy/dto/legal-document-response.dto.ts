// AR-36: the legal texts on the wire (BR-010-02, BR-010-04). Public: no account data.
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, Matches, MaxLength } from 'class-validator';
import { LEGAL_DOCUMENT_TYPES, VERSION_PATTERN } from '../domain/legal-versions.js';
import type { PublishedLegalDocument } from '../legal/legal-document.js';
import type { LegalVersionListing } from '../legal-documents.service.js';

/** GET /legal/:type/:version path parameters, validated like any input (AR-34). */
export class LegalVersionParamsDto {
  @ApiProperty({ enum: LEGAL_DOCUMENT_TYPES, enumName: 'LegalDocumentType' })
  @IsIn(LEGAL_DOCUMENT_TYPES)
  type!: string;

  @ApiProperty({ type: String, example: '0.1' })
  @MaxLength(32)
  @Matches(VERSION_PATTERN)
  version!: string;
}

export class LegalDocumentResponseDto {
  @ApiProperty({ enum: LEGAL_DOCUMENT_TYPES, enumName: 'LegalDocumentType' })
  type: string;

  @ApiProperty({ type: String, example: '0.1' })
  version: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'First instant the version is in force',
  })
  effectiveAt: Date;

  @ApiProperty({
    type: Boolean,
    description: 'True while the text is a placeholder not yet reviewed by a lawyer (BR-010-26)',
  })
  draft: boolean;

  @ApiProperty({ type: String })
  title: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Shown above the text; the draft marker',
  })
  banner: string | null;

  @ApiProperty({ type: String, description: 'The text, in Markdown' })
  content: string;

  @ApiProperty({ type: String, description: 'sha256 (hex) of the published text' })
  contentHash: string;

  constructor(document: PublishedLegalDocument) {
    this.type = document.type;
    this.version = document.version;
    this.effectiveAt = document.effectiveAt;
    this.draft = document.draft;
    this.title = document.title;
    this.banner = document.banner;
    this.content = document.content;
    this.contentHash = document.contentHash;
  }
}

/** GET /legal/current: the version in force of each document, with its text. */
export class CurrentLegalDocumentsResponseDto {
  @ApiProperty({ type: () => LegalDocumentResponseDto })
  terms: LegalDocumentResponseDto;

  @ApiProperty({ type: () => LegalDocumentResponseDto })
  privacy: LegalDocumentResponseDto;

  constructor(documents: { terms: PublishedLegalDocument; privacy: PublishedLegalDocument }) {
    this.terms = new LegalDocumentResponseDto(documents.terms);
    this.privacy = new LegalDocumentResponseDto(documents.privacy);
  }
}

export class LegalVersionSummaryResponseDto {
  @ApiProperty({ enum: LEGAL_DOCUMENT_TYPES, enumName: 'LegalDocumentType' })
  type: string;

  @ApiProperty({ type: String, example: '0.1' })
  version: string;

  @ApiProperty({ type: String, format: 'date-time' })
  effectiveAt: Date;

  @ApiProperty({ type: Boolean })
  draft: boolean;

  @ApiProperty({ type: String })
  title: string;

  @ApiProperty({ type: String })
  contentHash: string;

  @ApiProperty({ type: Boolean, description: 'Whether this is the version in force now' })
  current: boolean;

  constructor(listing: LegalVersionListing) {
    this.type = listing.document.type;
    this.version = listing.document.version;
    this.effectiveAt = listing.document.effectiveAt;
    this.draft = listing.document.draft;
    this.title = listing.document.title;
    this.contentHash = listing.document.contentHash;
    this.current = listing.current;
  }
}

/** AR-35 lookup exemption: the published versions of two documents, a handful, read at once. */
export class LegalVersionsResponseDto {
  @ApiProperty({
    type: () => [LegalVersionSummaryResponseDto],
    description: 'Every version in force or past, by document and newest first (BR-010-04)',
  })
  items: LegalVersionSummaryResponseDto[];

  constructor(listings: readonly LegalVersionListing[]) {
    this.items = listings.map((listing) => new LegalVersionSummaryResponseDto(listing));
  }
}
