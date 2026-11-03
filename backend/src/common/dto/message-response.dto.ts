// AR-36: the acknowledgement of a command with nothing else to return.
import { ApiProperty } from '@nestjs/swagger';

export class MessageResponseDto {
  @ApiProperty({ type: String, description: 'Acknowledgement of the command' })
  message: string;

  constructor(message: string) {
    this.message = message;
  }
}
