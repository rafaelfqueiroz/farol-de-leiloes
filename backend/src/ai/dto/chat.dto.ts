import { IsNotEmpty, IsString } from 'class-validator';

export class ChatRequestDto {
  @IsString()
  @IsNotEmpty()
  message!: string;
}

export class ChatResponseDto {
  state?: string;
  city?: string;
  neighborhood?: string;
  modality?: string;
  minMargin?: number;
  maxMargin?: number;
  limit?: number;
  offset?: number;
}
