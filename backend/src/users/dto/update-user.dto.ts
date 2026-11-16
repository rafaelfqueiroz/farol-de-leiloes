import {
  IsOptional,
  IsString,
  IsArray,
  IsEnum,
  IsDateString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class AddressDto {
  @IsString()
  @IsOptional()
  street?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  zipCode?: string;
}

// BR-001-31: no `password` here; passwords change only through UsersService.setPassword /
// changePassword (BR-001-31). BR-001-29 narrows the rest in the profile work.
export class UpdateUserDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsArray()
  @IsEnum(['local', 'google'], { each: true })
  @IsOptional()
  providers?: string[];

  @IsString()
  @IsOptional()
  googleId?: string;

  @IsEnum(['admin', 'free', 'standard', 'premium'])
  @IsOptional()
  role?: string;

  @IsString()
  @IsOptional()
  stripeCustomerId?: string;

  @IsString()
  @IsOptional()
  stripeSubscriptionId?: string;

  @IsEnum(['active', 'canceled', 'past_due', 'incomplete'])
  @IsOptional()
  subscriptionStatus?: string | null;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  cpf?: string;

  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  @IsEnum(['male', 'female', 'other'])
  @IsOptional()
  sex?: string;

  @ValidateNested()
  @Type(() => AddressDto)
  @IsOptional()
  address?: AddressDto;
}
