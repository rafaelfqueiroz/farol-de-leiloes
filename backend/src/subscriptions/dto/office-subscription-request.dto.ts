// AR-34: every body and query of the office billing API is a validated DTO. The office is NEVER
// taken from here as a fact: `officeId` only lets a member of several offices CHOOSE among its own
// (AccessContext.resolveActingOwner, BR-002-11); an office it is not a member of is the same
// NOT_FOUND as one that does not exist (AR-14).
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const OFFICE_ID_DESCRIPTION =
  'Which office, for a member of several; one of the caller own offices (BR-002-11)';

/** The office selector of a query (GET) or of an action that takes nothing else. */
export class OfficeSelectorDto {
  @ApiPropertyOptional({ type: String, maxLength: 64, description: OFFICE_ID_DESCRIPTION })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  officeId?: string;
}

export class CheckoutRequestDto {
  @ApiProperty({ type: String, maxLength: 100, description: 'Code of an offered plan' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  planCode!: string;

  @ApiPropertyOptional({
    type: String,
    maxLength: 100,
    description: 'A discount coupon code, for this new subscription only (SPEC-026)',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  couponCode?: string;

  @ApiPropertyOptional({ type: String, maxLength: 64, description: OFFICE_ID_DESCRIPTION })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  officeId?: string;
}

export class ChangePlanRequestDto {
  @ApiProperty({ type: String, maxLength: 100, description: 'Code of the plan to move to' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  planCode!: string;

  @ApiPropertyOptional({ type: String, maxLength: 64, description: OFFICE_ID_DESCRIPTION })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  officeId?: string;
}
