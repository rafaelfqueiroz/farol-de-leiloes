import { IsOptional, IsString } from 'class-validator';

// BR-001-31, DL-001-02: no `password`, `providers` or `googleId` here; passwords change only through UsersService.setPassword /
// changePassword (BR-001-31). BR-001-29 narrows the rest in the profile work.
// SPEC-012 BR-012-14: no `role`, `subscriptionStatus` or Stripe id either. A plan, a subscription
// state and a limit belong to an office and change only through the provider-confirmed sync
// (SubscriptionsService); nothing that writes an account can set them.
export class UpdateUserDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  phone?: string;
}
