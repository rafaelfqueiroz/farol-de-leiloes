import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: false }) // Optional for Google OAuth users
  password?: string;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: false, unique: true, sparse: true })
  googleId?: string;

  @Prop({ type: [String], required: true, enum: ['local', 'google'], default: ['local'] })
  providers!: string[];

  @Prop({ required: false })
  resetPasswordToken?: string;

  @Prop({ required: false })
  resetPasswordExpires?: Date;

  @Prop({ required: false, default: false })
  emailVerified!: boolean;

  @Prop({ required: false })
  emailVerificationToken?: string;

  @Prop({ required: false })
  emailVerificationExpires?: Date;

  // Role-based access control
  @Prop({ required: true, enum: ['admin', 'free', 'standard', 'premium'], default: 'free' })
  role!: string;

  // Stripe integration
  @Prop({ required: false, unique: true, sparse: true })
  stripeCustomerId?: string;

  @Prop({ required: false })
  stripeSubscriptionId?: string;

  @Prop({ type: String, required: false, enum: ['active', 'canceled', 'past_due', 'incomplete'], default: null })
  subscriptionStatus?: string | null;

  // Profile fields
  @Prop({ required: false })
  phone?: string;

  @Prop({ required: false })
  cpf?: string;

  @Prop({ required: false })
  dateOfBirth?: Date;

  @Prop({ required: false, enum: ['male', 'female', 'other'] })
  sex?: string;

  @Prop({ type: Object, required: false })
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
}

export const UserSchema = SchemaFactory.createForClass(User);

// Create indexes
UserSchema.index({ email: 1 });
UserSchema.index({ googleId: 1 }, { sparse: true });
UserSchema.index({ stripeCustomerId: 1 }, { sparse: true });
UserSchema.index({ role: 1 });
