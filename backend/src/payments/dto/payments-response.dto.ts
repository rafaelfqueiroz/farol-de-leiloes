// AR-36: the payment endpoint's response.
import { ApiProperty } from '@nestjs/swagger';

/** What Stripe gets back once an event is verified and handled. */
export class WebhookAckResponseDto {
  @ApiProperty({ type: Boolean, description: 'Always true' })
  readonly received: boolean = true;
}
