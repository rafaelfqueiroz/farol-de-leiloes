import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsDateString, IsEnum, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export const SEX_VALUES = ['male', 'female', 'other'] as const;

export class ProfileAddressDto {
  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  street?: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  zipCode?: string;
}

export class CompleteProfileDto {
  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  cpf?: string;

  @ApiPropertyOptional({ type: String, format: 'date' })
  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  @ApiPropertyOptional({ enum: SEX_VALUES, enumName: 'Sex' })
  @IsEnum(SEX_VALUES)
  @IsOptional()
  sex?: string;

  @ApiPropertyOptional({ type: () => ProfileAddressDto })
  @ValidateNested()
  @Type(() => ProfileAddressDto)
  @IsOptional()
  address?: ProfileAddressDto;
}
