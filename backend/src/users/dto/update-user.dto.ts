import { IsOptional, IsString, IsEnum } from 'class-validator';

// BR-001-31, DL-001-02: no `password`, `providers` or `googleId` here; passwords change only through UsersService.setPassword /
// changePassword (BR-001-31). BR-001-29 narrows the rest in the profile work.
export class UpdateUserDto {
  @IsString()
  @IsOptional()
  name?: string;

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
}
