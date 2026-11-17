import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { markIsolation } from '../../access/isolation-mark.js';
import {
  PLAN_AUDIENCES,
  PLAN_INTERVALS,
  PLAN_STATUSES,
  type PlanAudience,
  type PlanInterval,
  type PlanStatus,
} from '../plan.js';

/**
 * SPEC-012 BR-012-01, BR-012-02: a catalog entry operators maintain with `npm run plans:upsert`
 * (no code release), read by the public plans page and by the subscription sync. Editing a plan
 * never edits a subscription: each subscription holds its own copy of the limit (BR-012-04).
 */
@Schema({ collection: 'plans', timestamps: true })
export class PlanEntity {
  @Prop({ required: true, type: String, trim: true })
  code!: string;

  @Prop({ required: true, type: String, trim: true })
  name!: string;

  @Prop({ required: true, type: String, enum: PLAN_AUDIENCES, default: 'ADVISOR_OFFICE' })
  audience!: PlanAudience;

  // AR-17: reais as Decimal128, never centavos or a float. Centavos exist only in the Stripe adapter.
  @Prop({ required: true, type: MongooseSchema.Types.Decimal128 })
  price!: Types.Decimal128;

  @Prop({ required: true, type: String, enum: PLAN_INTERVALS })
  interval!: PlanInterval;

  @Prop({ required: true, type: Number, min: 1, validate: Number.isInteger })
  activeJourneyLimit!: number;

  @Prop({ required: true, type: String, trim: true })
  stripePriceId!: string;

  @Prop({ required: true, type: String, enum: PLAN_STATUSES, default: 'OFFERED' })
  status!: PlanStatus;

  @Prop({ required: true, type: Number, default: 0 })
  sortOrder!: number;
}

export type PlanDocument = HydratedDocument<PlanEntity>;

export const PlanSchema = SchemaFactory.createForClass(PlanEntity);

// Built in production by migration 0006-subscription-indexes (AR-29, DV-34), whose unit spec
// (subscriptions/schemas/subscription-indexes.spec.ts) holds it equal to these.
// BR-012-02: the catalog script upserts by code, and a provider price belongs to one plan.
PlanSchema.index({ code: 1 }, { unique: true });
PlanSchema.index({ stripePriceId: 1 }, { unique: true });
// AR-27: the plans page lists the offered ones in the operator's order.
PlanSchema.index({ status: 1, sortOrder: 1 });

// AR-16: platform configuration, the same for everybody; no owner, no personal data.
markIsolation(PlanSchema, {
  kind: 'public',
  reason:
    'Plan catalog (SPEC-012 BR-012-02): operator configuration shown on the public plans page; no account or client data',
});
