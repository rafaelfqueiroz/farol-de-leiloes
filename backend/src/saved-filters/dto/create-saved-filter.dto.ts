import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsObject, IsString, MaxLength, ValidateNested } from 'class-validator';
import { FilterDataDto } from './filter-data.dto';

export class CreateSavedFilterDto {
  @ApiProperty({ type: String, maxLength: 100, description: 'Unique among the user filters' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  // ValidateNested alone lets a missing object through.
  @ApiProperty({ type: () => FilterDataDto })
  @IsObject()
  @ValidateNested()
  @Type(() => FilterDataDto)
  filters!: FilterDataDto;
}
