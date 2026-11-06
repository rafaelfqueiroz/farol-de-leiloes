import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { SUBSCRIPTION_STATUSES, SubscriptionStatus } from '../subscription-status';
import type { UserAccount, UserAddress } from '../user-account';

export type UserDocument = UserEntity & Document;

@Schema({ collection: 'users', timestamps: true })
export class UserEntity extends Document implements UserAccount {
  override _id!: Types.ObjectId;

  // Supplied by timestamps: true; part of the public UsersService account contract (AR-09).
  createdAt!: Date;
  updatedAt!: Date;

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

  @Prop({
    type: String,
    required: false,
    enum: [...SUBSCRIPTION_STATUSES, null],
    default: null,
  })
  subscriptionStatus?: SubscriptionStatus | null;

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
  address?: UserAddress;
}

export const UserSchema = SchemaFactory.createForClass(UserEntity);

// email, googleId and stripeCustomerId are indexed by their `unique` @Prop options; declaring them
// again here makes Mongoose 9 warn about duplicate indexes (TESTING §2: stray output is a defect).
UserSchema.index({ role: 1 });
