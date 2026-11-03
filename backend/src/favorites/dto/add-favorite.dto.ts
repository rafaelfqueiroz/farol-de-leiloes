import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AddFavoriteDto {
  @ApiProperty({ type: String, description: 'Caixa code of the auction to favorite' })
  @IsString()
  @IsNotEmpty()
  code!: string;
}
