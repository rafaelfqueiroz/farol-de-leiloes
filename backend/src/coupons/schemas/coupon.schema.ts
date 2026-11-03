import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type CouponDocument = CouponEntity & Document;

@Schema({ collection: 'coupons', timestamps: true })
export class CouponEntity extends Document {
  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  code!: string;

  // AR-17: the absolute discount in reais, as Decimal128. It was integer centavos before #34 and
  // was converted in place by migrations/0001-money-decimal128.ts (AR-29), which must run before
  // this schema is deployed (DV-34): a Decimal128 path casts a leftover 1000 (centavos) on
  // hydration to Decimal128 1000, which would read as R$ 1.000,00.
  @Prop({ type: MongooseSchema.Types.Decimal128, required: true })
  discountValue!: Types.Decimal128;

  @Prop({ required: true })
  validTo!: Date;

  @Prop({ required: true, default: true })
  active!: boolean;

  @Prop({ required: false })
  stripeCouponId?: string;

  @Prop({ required: false })
  stripePromotionCodeId?: string;

  @Prop({ required: false })
  description?: string;

  // Set by Mongoose (timestamps: true), not a @Prop.
  createdAt!: Date;
  updatedAt!: Date;
}

export const CouponSchema = SchemaFactory.createForClass(CouponEntity);

CouponSchema.index({ code: 1 }, { unique: true });
