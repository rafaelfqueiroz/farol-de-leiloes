// AR-36, BR-009-11: a support request leaves the ADMIN's routes through these classes, each field copied
// explicitly. The text is a plain string: the API never wraps or marks it up, and the admin's screen
// shows it as text (BR-009-11). The requester's name and address are what the team needs to answer by
// email (BR-009-10); nothing else of the account, no outbox state, no other admin's grant.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { OpenedGrant } from '../../admin-access/support-grant.service.js';
import { SupportRequestSummaryDto } from './support-request-response.dto.js';
import type { SupportRequestRecord } from '../support-requests.repository.js';

/** The requester, as the team needs to know them to answer (BR-009-10). */
export class SupportRequesterDto {
  @ApiProperty({ type: String, nullable: true })
  name: string | null;

  @ApiProperty({ type: String, nullable: true })
  email: string | null;

  constructor(requester: { readonly name: string; readonly email: string } | null) {
    this.name = requester?.name ?? null;
    this.email = requester?.email ?? null;
  }
}

/** The grant THIS admin holds on the request (BR-009-12, BR-002-24); never another admin's. */
export class SupportGrantDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  supportRequestId: string;

  @ApiProperty({ type: String, format: 'date-time' })
  openedAt: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Seven days after it opened (BR-002-26)',
  })
  expiresAt: Date;

  constructor(grant: OpenedGrant) {
    this.id = grant.id;
    this.supportRequestId = grant.supportRequestId;
    this.openedAt = grant.openedAt;
    this.expiresAt = grant.expiresAt;
  }
}

/** A request in full, for the admin who answers it by email (BR-009-10, BR-009-12). */
export class SupportRequestAdminDetailDto extends SupportRequestSummaryDto {
  @ApiProperty({
    type: String,
    description: 'The message as typed: plain text, never markup (BR-009-11)',
  })
  message: string;

  @ApiProperty({ type: () => SupportRequesterDto })
  requester: SupportRequesterDto;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  dataAccessWithdrawnAt?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', description: 'When it was closed' })
  closedAt?: Date;

  @ApiProperty({
    type: () => SupportGrantDto,
    nullable: true,
    description:
      'The grant this admin holds on the request, if any and still valid; null otherwise',
  })
  grant: SupportGrantDto | null;

  constructor(
    request: SupportRequestRecord,
    requester: { readonly name: string; readonly email: string } | null,
    grant: OpenedGrant | null,
  ) {
    super(request);
    this.message = request.message;
    this.requester = new SupportRequesterDto(requester);
    this.dataAccessWithdrawnAt = request.dataAccessWithdrawnAt;
    this.closedAt = request.closedAt;
    this.grant = grant ? new SupportGrantDto(grant) : null;
  }
}
