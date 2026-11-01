import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export enum ReminderChannel {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  WHATSAPP = 'WHATSAPP',
}

export enum ReminderStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
}

@Schema({ collection: 'reminders', timestamps: true })
export class ReminderEntity extends Document {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserEntity',
    required: true,
    index: true,
  })
  userId!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'AuctionEntity',
    required: true,
    index: true,
  })
  auction!: Types.ObjectId;

  @Prop({ required: true, type: String, enum: ReminderChannel })
  channel!: ReminderChannel;

  @Prop({ required: true, type: Date, index: true })
  scheduledAt!: Date;

  @Prop({ required: false, maxlength: 500 })
  description?: string;

  @Prop({
    required: true,
    type: String,
    enum: ReminderStatus,
    default: ReminderStatus.PENDING,
  })
  status!: ReminderStatus;

  // Set by Mongoose (timestamps: true), not a @Prop.
  createdAt!: Date;
  updatedAt!: Date;
}

export type ReminderDocument = HydratedDocument<ReminderEntity>;

export const ReminderSchema = SchemaFactory.createForClass(ReminderEntity);

ReminderSchema.index({ userId: 1, auction: 1 });
ReminderSchema.index({ scheduledAt: 1, status: 1 });
