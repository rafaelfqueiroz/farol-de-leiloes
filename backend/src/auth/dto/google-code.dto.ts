import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** The one-time code of the redirect back from Google (BR-001-20). */
export class GoogleCodeDto {
  @ApiProperty({ type: String, description: 'The `code` of the /auth/callback redirect' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  code!: string;
}

/** The person accepts the current terms and a Google sign-up completes (BR-001-09, BR-010-01). */
export class GoogleCompleteDto extends GoogleCodeDto {
  @ApiProperty({ type: Boolean, enum: [true], description: 'Must be true: the terms are accepted' })
  @IsBoolean()
  @Equals(true)
  acceptTerms!: boolean;
}
