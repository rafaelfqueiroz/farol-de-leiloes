import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { markIsolation } from '../../access/isolation-mark.js';

export type MaintenanceWindowDocument = MaintenanceWindowEntity & Document;

/**
 * SPEC-003 BR-003-03: scheduled maintenance announced in the product. Not owned data (no
 * `ownerId`, AR-16): it is platform-wide and the upcoming ones are public.
 */
@Schema({ collection: 'maintenancewindows', timestamps: true })
export class MaintenanceWindowEntity extends Document {
  // AR-22: UTC instants. The product shows them in Brasília time (BR-003-23).
  // AR-27: the query path of the public banner and the admin list is startsAt.
  @Prop({ required: true, index: true })
  startsAt!: Date;

  @Prop({ required: true })
  endsAt!: Date;

  // pt-BR text written by an admin; shown to every visitor, so never personal data (SC-15).
  @Prop({ required: true, trim: true })
  message!: string;

  // BR-003-03: set from the injected Clock at creation, never from the request. It is what
  // decides whether the window counts as excluded, so it is never updated.
  @Prop({ required: true, immutable: true })
  announcedAt!: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'UserEntity', required: true, immutable: true })
  createdBy!: Types.ObjectId;

  // Set by Mongoose (timestamps: true), not a @Prop.
  createdAt!: Date;
  updatedAt!: Date;
}

export const MaintenanceWindowSchema = SchemaFactory.createForClass(MaintenanceWindowEntity);

// AR-16 / TS-14: the isolation class of this collection.
markIsolation(MaintenanceWindowSchema, {
  kind: 'public',
  reason: 'Platform maintenance announcements, shown to every visitor',
});
