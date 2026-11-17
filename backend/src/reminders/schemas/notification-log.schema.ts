import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ReminderChannel } from './reminder.schema.js';
import { markIsolation } from '../../access/isolation-mark.js';

@Schema({ collection: 'notificationlogs', timestamps: { createdAt: true, updatedAt: false } })
export class NotificationLog {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'ReminderEntity',
    required: true,
    index: true,
  })
  reminderId!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserEntity',
    required: true,
    index: true,
  })
  userId!: Types.ObjectId;

  @Prop({ required: true, type: String, enum: ReminderChannel })
  channel!: ReminderChannel;

  @Prop({ required: true })
  recipient!: string;

  @Prop({ required: true })
  success!: boolean;

  @Prop({ required: false })
  errorMessage?: string;
}

export type NotificationLogDocument = HydratedDocument<NotificationLog>;

export const NotificationLogSchema = SchemaFactory.createForClass(NotificationLog);

// AR-16 / TS-14: the isolation class of this collection.
markIsolation(NotificationLogSchema, {
  kind: 'account',
  reason:
    "SPEC-002 BR-002-02: delivery attempts of the account's own reminders, written by the scheduler for the reminder's account (BR-002-29); no API reads them",
});

NotificationLogSchema.index({ createdAt: -1 });
