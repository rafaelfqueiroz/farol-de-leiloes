import { NewPasswordField } from './new-password.decorator.js';

export class SetPasswordDto {
  @NewPasswordField()
  newPassword!: string;
}
