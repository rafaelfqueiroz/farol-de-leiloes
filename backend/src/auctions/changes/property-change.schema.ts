import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { markIsolation } from '../../access/isolation-mark.js';
import {
  CHANGE_SOURCES,
  CHANGE_TYPES,
  type ChangeSource,
  type ChangeType,
  type ChangeValue,
} from '../domain/change-types.js';

/**
 * SPEC-004 BR-004-25, BR-004-26: one entry per tracked field that changed on a property, in a run.
 * Money is a decimal string (AR-17), never a number. The unique (run, property, field, type) is what
 * makes writing the same list's entries twice end with one of each (BR-004-07). Property data
 * only: nothing about an account or a client (SC-15).
 */
@Schema({ collection: 'propertychanges', timestamps: { createdAt: true, updatedAt: false } })
export class PropertyChangeEntity {
  /** The Caixa property number. */
  @Prop({ required: true, type: String })
  propertyCode!: string;

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  importRunId!: Types.ObjectId;

  @Prop({ required: true, type: String, enum: CHANGE_SOURCES })
  source!: ChangeSource;

  @Prop({ required: true, type: String, enum: CHANGE_TYPES })
  type!: ChangeType;

  /** BR-004-26: what the Radar and the digest read. */
  @Prop({ required: true, type: Boolean })
  relevant!: boolean;

  @Prop({ required: true, type: String })
  field!: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  oldValue!: ChangeValue;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  newValue!: ChangeValue;

  /** From the injected Clock (AR-24). */
  createdAt!: Date;
}

export type PropertyChangeDocument = HydratedDocument<PropertyChangeEntity>;

export const PropertyChangeSchema = SchemaFactory.createForClass(PropertyChangeEntity);

// AR-27 / AR-29: built in production by migration 0012-auction-import-model, whose unit spec holds
// them equal to these.
PropertyChangeSchema.index({ importRunId: 1 });
PropertyChangeSchema.index({ propertyCode: 1, createdAt: -1 });
PropertyChangeSchema.index({ relevant: 1, createdAt: 1 });
// The type is part of the key: RETURNED and BECAME_UNAVAILABLE share the field `available`, and
// an attempt that retries a day with another list must be able to record both in one run.
PropertyChangeSchema.index(
  { importRunId: 1, propertyCode: 1, field: 1, type: 1 },
  { unique: true, name: 'one_change_per_run_property_field_type' },
);

markIsolation(PropertyChangeSchema, {
  kind: 'public',
  reason:
    'Change history of the public Caixa catalogue (SPEC-004 BR-004-25): property numbers, field names and old/new values, the same for every visitor, no account or client data (SC-15)',
});
