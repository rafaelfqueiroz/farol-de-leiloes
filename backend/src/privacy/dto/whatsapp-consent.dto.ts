import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import {
  WHATSAPP_ACTIONS,
  WHATSAPP_ANSWER_METHODS,
  type WhatsappAction,
} from '../domain/whatsapp-consent.js';
import type { WhatsappConsentView } from '../whatsapp-consent.service.js';

/**
 * POST /privacy/whatsapp-consent (BR-010-27): the account answers the one-time request, or grants
 * or withdraws the consent from its privacy page. Whose consent it is comes from the session,
 * never from the body (BR-002-11).
 */
export class RecordWhatsappConsentDto {
  @ApiProperty({ enum: WHATSAPP_ACTIONS, enumName: 'WhatsappConsentAction' })
  @IsIn(WHATSAPP_ACTIONS)
  action!: WhatsappAction;

  @ApiProperty({
    enum: WHATSAPP_ANSWER_METHODS,
    enumName: 'WhatsappConsentAnswerMethod',
    description: 'Where the answer was given: the one-time prompt or the privacy page',
  })
  @IsIn(WHATSAPP_ANSWER_METHODS)
  method!: (typeof WHATSAPP_ANSWER_METHODS)[number];
}

export const WHATSAPP_CONSENT_STATES = ['none', ...WHATSAPP_ACTIONS] as const;

export class WhatsappConsentResponseDto {
  @ApiProperty({
    enum: WHATSAPP_CONSENT_STATES,
    enumName: 'WhatsappConsentState',
    description: 'The latest answer; `none` when the account never answered',
  })
  state: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  at: Date | null;

  @ApiProperty({ type: String, nullable: true, description: 'Version of the text answered' })
  textVersion: string | null;

  constructor(view: WhatsappConsentView) {
    this.state = view.state;
    this.at = view.at;
    this.textVersion = view.textVersion;
  }
}
