// AR-36: the identity of one legal text on the wire, used by GET /auth/me (documents still to
// accept) and by the accept routes.
import { ApiProperty } from '@nestjs/swagger';
import { LEGAL_DOCUMENT_TYPES, type LegalDocumentRef } from '../domain/legal-versions.js';

export class LegalDocumentRefDto {
  @ApiProperty({ enum: LEGAL_DOCUMENT_TYPES, enumName: 'LegalDocumentType' })
  type: string;

  @ApiProperty({ type: String, example: '0.1' })
  version: string;

  constructor(ref: LegalDocumentRef) {
    this.type = ref.type;
    this.version = ref.version;
  }
}
