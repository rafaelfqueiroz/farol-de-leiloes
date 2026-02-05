export interface UserProfile {
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
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthResult {
  accessToken: string;
  user: UserProfile;
}
