import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ReminderChannel } from './reminder.schema';

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

NotificationLogSchema.index({ createdAt: -1 });
