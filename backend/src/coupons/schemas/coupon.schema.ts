import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import type { StoredMoney } from '../../common/money/stored-money';

export type CouponDocument = CouponEntity & Document;

@Schema({ collection: 'coupons', timestamps: true })
export class CouponEntity extends Document {
  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  code!: string;

  // AR-17: the absolute discount in reais, written as Decimal128 (#34, converted in place).
  // EXPAND (AR-28): remove in contract step, #34 PR 2 — until the migration, legacy documents hold
  // integer centavos as a number, read through fromStoredCouponDiscount. The path is Mixed for
  // that reason: a Decimal128 path would cast a legacy 1000 (centavos) to Decimal128 1000 when a
  // document is hydrated, and it would then read as R$ 1.000,00. PR 2 makes it Decimal128.
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  discountValue!: StoredMoney;

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
