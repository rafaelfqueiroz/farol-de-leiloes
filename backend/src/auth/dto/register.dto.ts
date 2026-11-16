import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsNotEmpty, IsString } from 'class-validator';
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

  // BR-001-02: sign-up requires accepting the current terms and privacy policy; a missing or false
  // value is a VALIDATION_FAILED before any account exists.
  // TODO(#10): SPEC-010 records the acceptance (versions, time, method)
  @ApiProperty({ type: Boolean, enum: [true], description: 'Must be true' })
  @Equals(true)
  acceptTerms!: true;
}
