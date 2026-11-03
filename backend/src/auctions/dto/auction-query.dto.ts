// AR-34: the auction list and neighborhood queries as validated DTOs.
//
// Express 5 (Nest 12, #61) parses the query string with its `simple` parser (node:querystring): a
// repeated key becomes an array, bracket keys (`city[]`) do not nest. The list filters take
// several values as a repeated key (`city=A&city=B`) or comma-separated (`city=A,B`); the
// transforms below normalise both, and auctions.controller.spec.ts pins that contract.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { PhaseModality } from '../schemas/auction.schema';

const LIST_DESCRIPTION =
  'Several values: repeat the key (?k=A&k=B) or separate with commas (?k=A,B)';

/** A repeated key stays a list; `A, B` becomes ['A', 'B']; a single value stays a string. */
function splitCommas({ value }: TransformFnParams): unknown {
  if (typeof value !== 'string' || !value.includes(',')) return value;
  return value.split(',').map((item) => item.trim());
}

/** As splitCommas, but always a list: a single value becomes [value]. */
function toList(params: TransformFnParams): unknown {
  const value = splitCommas(params);
  return typeof value === 'string' ? [value] : value;
}

export class ListAuctionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ type: String, description: 'UF, e.g. SP (case-insensitive)' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    description: `Prefix match. ${LIST_DESCRIPTION}`,
  })
  @IsOptional()
  @Transform(splitCommas)
  @IsString({ each: true })
  city?: string | string[];

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    description: `Prefix match. ${LIST_DESCRIPTION}`,
  })
  @IsOptional()
  @Transform(splitCommas)
  @IsString({ each: true })
  neighborhood?: string | string[];

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    description: `Current phase modality (${Object.values(PhaseModality).join(', ')}). ${LIST_DESCRIPTION}`,
  })
  @IsOptional()
  @Transform(splitCommas)
  @IsString({ each: true })
  modality?: string | string[];

  @ApiPropertyOptional({ type: Number, minimum: 0, description: 'Lowest minimum price, BRL' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minMargin?: number;

  @ApiPropertyOptional({ type: Number, minimum: 0, description: 'Highest minimum price, BRL' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxMargin?: number;
}

export class NeighborhoodsQueryDto {
  @ApiProperty({ type: String, description: 'UF, e.g. SP (case-insensitive)' })
  @IsString()
  @IsNotEmpty()
  state!: string;

  @ApiProperty({ type: String, isArray: true, description: `Prefix match. ${LIST_DESCRIPTION}` })
  @Transform(toList)
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  city!: string[];
}
