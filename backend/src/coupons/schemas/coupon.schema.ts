import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CouponDocument = CouponEntity & Document;

@Schema({ timestamps: true })
export class CouponEntity extends Document {
  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  code!: string;

  @Prop({ required: true })
  discountValue!: number; // absolute discount in cents (BRL)

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
}

export const CouponSchema = SchemaFactory.createForClass(CouponEntity);

CouponSchema.index({ code: 1 }, { unique: true });
