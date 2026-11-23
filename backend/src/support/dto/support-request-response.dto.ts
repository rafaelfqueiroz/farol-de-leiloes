// AR-36: a support request leaves the API through these classes, each field copied explicitly. The
// requester's id, the outbox state and the claim never do.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  type DataAccessState,
  dataAccessState,
  SUPPORT_REQUEST_STATUSES,
} from '../domain/support-request.js';
import type { SupportRequestRecord } from '../support-requests.repository.js';

const DATA_ACCESS_STATES = [
  'not_given',
  'allowed',
  'withdrawn',
] as const satisfies readonly DataAccessState[];

/** One row of the requester's own list (BR-009-09): protocol, subject, date, status, permission. */
export class SupportRequestSummaryDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String, example: 'FL-2026-000042' })
  protocol: string;

  @ApiProperty({ type: String })
  subject: string;

  @ApiProperty({ type: String, format: 'date-time', description: 'When it was opened' })
  createdAt: Date;

  @ApiProperty({ enum: SUPPORT_REQUEST_STATUSES, enumName: 'SupportRequestStatus' })
  status: string;

  @ApiProperty({
    enum: DATA_ACCESS_STATES,
    enumName: 'SupportDataAccess',
    description:
      'The permission for the support team to view the requester’s data: never given, in force, or withdrawn',
  })
  dataAccess: string;

  constructor(request: SupportRequestRecord) {
    this.id = request._id.toHexString();
    this.protocol = request.protocol;
    this.subject = request.subject;
    this.createdAt = request.createdAt;
    this.status = request.status;
    this.dataAccess = dataAccessState(request);
  }
}

/** One request in full: the list row plus the message and the dates of the permission and of the end. */
export class SupportRequestResponseDto extends SupportRequestSummaryDto {
  @ApiProperty({ type: String, description: 'The message as typed, plain text' })
  message: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'When the requester withdrew the permission',
  })
  dataAccessWithdrawnAt?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', description: 'When it was closed' })
  closedAt?: Date;

  constructor(request: SupportRequestRecord) {
    super(request);
    this.message = request.message;
    this.dataAccessWithdrawnAt = request.dataAccessWithdrawnAt;
    this.closedAt = request.closedAt;
  }
}

/** The answer to a new request (BR-009-06, BR-009-07): the protocol to show, and whether the mail left. */
export class CreateSupportRequestResponseDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String, example: 'FL-2026-000042' })
  protocol: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ enum: SUPPORT_REQUEST_STATUSES, enumName: 'SupportRequestStatus' })
  status: string;

  @ApiProperty({
    type: Boolean,
    description:
      'Whether the confirmation email is already delivered. False is not an error: the request is stored ' +
      'and the email is retried (BR-009-07).',
  })
  confirmationSent: boolean;

  constructor(request: SupportRequestRecord, confirmationSent: boolean) {
    this.id = request._id.toHexString();
    this.protocol = request.protocol;
    this.createdAt = request.createdAt;
    this.status = request.status;
    this.confirmationSent = confirmationSent;
  }
}

/** BR-009-03: the support team's address, for people who cannot sign in. */
export class SupportContactResponseDto {
  @ApiProperty({ type: String, format: 'email' })
  email: string;

  constructor(email: string) {
    this.email = email;
  }
}
