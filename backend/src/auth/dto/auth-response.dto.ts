import { UserProfile, AuthResult } from '../interfaces/auth.interface';

export class UserProfileResponseDto {
  _id: string;
  email: string;
  name: string;
  providers: string[];
  emailVerified: boolean;
  role: string;
  phone?: string;
  cpf?: string;
  dateOfBirth?: Date;
  sex?: string;
  address?: UserProfile['address'];
  createdAt: Date;
  updatedAt: Date;

  constructor(profile: UserProfile) {
    this._id = profile._id;
    this.email = profile.email;
    this.name = profile.name;
    this.providers = profile.providers;
    this.emailVerified = profile.emailVerified;
    this.role = profile.role;
    this.phone = profile.phone;
    this.cpf = profile.cpf;
    this.dateOfBirth = profile.dateOfBirth;
    this.sex = profile.sex;
    this.address = profile.address;
    this.createdAt = profile.createdAt;
    this.updatedAt = profile.updatedAt;
  }
}

export class AuthResponseDto {
  accessToken: string;
  user: UserProfileResponseDto;

  constructor(result: AuthResult) {
    this.accessToken = result.accessToken;
    this.user = new UserProfileResponseDto(result.user);
  }
}
