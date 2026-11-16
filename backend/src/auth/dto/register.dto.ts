import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { EmailField } from './normalize-email.decorator.js';
import { NewPasswordField } from './new-password.decorator.js';

// BR-001-31: these four properties are the whole sign-up contract. forbidNonWhitelisted turns a
// `role`, `plan` or anything else into a 400 before an account exists.
export class RegisterDto {
  @EmailField()
  email!: string;

  @NewPasswordField()
  password!: string;

  @ApiProperty({ type: String })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  name!: string;

  // BR-001-02: sign-up requires accepting the current terms and privacy policy. Optional here, and
  // refused when present but not true, only until the sign-up form carries the checkbox (its
  // DS-30 frame is awaiting approval on #1); the frontend PR makes it required in the same change.
  // TODO(#10): SPEC-010 records the acceptance (versions, time, method)
  @ApiPropertyOptional({ type: Boolean, enum: [true], description: 'Must be true when sent' })
  @IsOptional()
  @Equals(true)
  acceptTerms?: true;
}
