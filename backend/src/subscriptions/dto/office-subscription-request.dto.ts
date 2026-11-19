// AR-34: every body and query of the office billing API is a validated DTO. The office is NEVER
// taken from here as a fact: `officeId` only lets a member of several offices CHOOSE among its own
// (AccessContext.resolveActingOwner, BR-002-11); an office it is not a member of is the same
// NOT_FOUND as one that does not exist (AR-14).
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Decimal } from '../../common/money/money.js';
import { IsMoneyString, MONEY_API_PROPERTY } from '../../common/money/money-dto.js';
import { MAX_PAGE_SIZE } from '../../common/pagination/pagination-query.dto.js';

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

/**
 * BR-012-16: the quote of an upgrade, sent back by the member to confirm it. Only the plan, the
 * pinned instant, the amount and the next charge date are read, and the server re-asks the
 * provider as of that instant: nothing here is a fact. `expiresAt` and `currency` are accepted
 * because the preview answered them, and ignored (the expiry comes from the pinned instant).
 */
export class PlanQuoteRequestDto {
  @ApiProperty({ type: String, maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  planCode!: string;

  @ApiProperty({ type: String, format: 'date-time', description: 'The pinned proration date' })
  @Type(() => Date)
  @IsDate()
  prorationDate!: Date;

  @ApiProperty({ ...MONEY_API_PROPERTY, description: 'The amount due the member saw, in reais' })
  @IsMoneyString()
  amountDue!: Decimal;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  nextChargeDate?: Date | null;

  @ApiPropertyOptional({ type: String, description: 'Accepted and ignored' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', description: 'Accepted and ignored' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;
}

export class ChangePlanRequestDto {
  @ApiProperty({ type: String, maxLength: 100, description: 'Code of the plan to move to' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  planCode!: string;

  @ApiPropertyOptional({
    type: () => PlanQuoteRequestDto,
    description:
      'Required for an upgrade (the quote `change-preview` answered); QUOTE_STALE (409) when it ' +
      'is missing, expired or no longer true (BR-012-16)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlanQuoteRequestDto)
  quote?: PlanQuoteRequestDto;

  @ApiPropertyOptional({ type: String, maxLength: 64, description: OFFICE_ID_DESCRIPTION })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  officeId?: string;
}

/** The default page of the billing history: the plan page shows the last six charges (BR-012-11). */
export const BILLING_HISTORY_PAGE_SIZE = 6;

/** AR-35: the billing history is paginated; six rows a page unless asked otherwise. */
export class InvoicesQueryDto {
  @ApiPropertyOptional({ type: String, maxLength: 64, description: OFFICE_ID_DESCRIPTION })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  officeId?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, default: 1, description: '1-based page' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: BILLING_HISTORY_PAGE_SIZE,
    description: `Invoices per page, 1 to ${MAX_PAGE_SIZE}`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = BILLING_HISTORY_PAGE_SIZE;
}
