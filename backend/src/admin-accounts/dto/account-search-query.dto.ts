import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../common/pagination/pagination-query.dto.js';
import { normaliseSearchTerms, SEARCH_LENGTH } from '../domain/account-search.js';

/** The terms are normalised BEFORE they are measured, so the validated value is the one searched and logged. */
const normalised = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? normaliseSearchTerms(value) : value;

/**
 * GET /api/admin/accounts (BR-009-13): the terms (3 to 100 characters after trimming) and the page. `q`
 * is required: a listing of every account is not offered. Anything else in the query is refused
 * (`forbidNonWhitelisted`).
 */
export class AccountSearchQueryDto {
  @ApiProperty({
    type: String,
    minLength: SEARCH_LENGTH.min,
    maxLength: SEARCH_LENGTH.max,
    description:
      'Part of a name or an email, case-insensitive (contains). Trimmed and normalised first, then 3 to 100 characters',
  })
  @Transform(normalised)
  @IsString()
  @MinLength(SEARCH_LENGTH.min)
  @MaxLength(SEARCH_LENGTH.max)
  q!: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, default: 1, description: '1-based page' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
    description: `Items per page, 1 to ${MAX_PAGE_SIZE}`,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;
}
